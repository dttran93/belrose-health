const { expect } = require('chai');
const { ethers, upgrades } = require('hardhat');

describe('Trustee access on anchor/unanchor', function () {
  let memberRoleManager;
  let healthRecordCore;
  let admin, subject, trustee;

  const subjectIdHash = ethers.id('subject-uid');
  const trusteeIdHash = ethers.id('trustee-uid');

  beforeEach(async function () {
    [admin, subject, trustee] = await ethers.getSigners();

    const MemberRoleManager = await ethers.getContractFactory('MemberRoleManager', admin);
    memberRoleManager = await upgrades.deployProxy(MemberRoleManager, [], { kind: 'uups' });
    await memberRoleManager.waitForDeployment();

    const HealthRecordCore = await ethers.getContractFactory('HealthRecordCore', admin);
    healthRecordCore = await upgrades.deployProxy(
      HealthRecordCore,
      [await memberRoleManager.getAddress()],
      { kind: 'uups' }
    );
    await healthRecordCore.waitForDeployment();

    await memberRoleManager
      .connect(admin)
      .setHealthRecordCore(await healthRecordCore.getAddress());

    await memberRoleManager.connect(admin).addMember(subject.address, subjectIdHash);
    await memberRoleManager.connect(admin).addMember(trustee.address, trusteeIdHash);
  });

  it('auto-grants the trustee a mirrored role on anchor and auto-revokes it on unanchor', async function () {
    const recordIdHash = ethers.id('record-1');
    const recordHash = ethers.id('content-1');

    await memberRoleManager
      .connect(admin)
      .initializeRecordRole(recordIdHash, subject.address, 'owner');

    // Controller level fully mirrors the trustor's role
    await memberRoleManager.connect(admin).bootstrapDependentTrustee(subjectIdHash, trusteeIdHash);

    // Trustee has no role on this record yet
    expect(await memberRoleManager.hasActiveRole(recordIdHash, trustee.address)).to.equal(false);

    // Anchor triggers extendTrusteeGrantsOnAnchor — trustee should auto-receive the mirrored role
    await healthRecordCore
      .connect(subject)
      .anchorRecord(recordIdHash, recordHash, ethers.ZeroHash, 0);

    expect(await memberRoleManager.hasRole(recordIdHash, trustee.address, 'owner')).to.equal(true);

    // Unanchor triggers retractTrusteeGrantsOnUnanchor — trustee's mirrored role should be revoked
    await healthRecordCore.connect(subject).unanchorRecord(recordIdHash, ethers.ZeroHash);

    expect(await memberRoleManager.hasActiveRole(recordIdHash, trustee.address)).to.equal(false);
  });

  it('upgrades a trustee with lower independent access on anchor, and downgrades back to it on unanchor', async function () {
    const recordIdHash = ethers.id('record-3');
    const recordHash = ethers.id('content-3');

    // Trustee independently has viewer access, unrelated to the trust relationship — granted
    // before the subject even anchors this record.
    await memberRoleManager
      .connect(admin)
      .initializeRecordRole(recordIdHash, subject.address, 'owner');
    await memberRoleManager.connect(subject).grantRole(recordIdHash, trustee.address, 'viewer');

    // Controller level fully mirrors the trustor's role
    await memberRoleManager.connect(admin).bootstrapDependentTrustee(subjectIdHash, trusteeIdHash);

    expect(await memberRoleManager.hasRole(recordIdHash, trustee.address, 'viewer')).to.equal(true);

    // Anchor triggers extendTrusteeGrantsOnAnchor — trustee should be upgraded from viewer to
    // owner (their independent viewer role is strictly lower-ranked than the resolved role).
    await healthRecordCore
      .connect(subject)
      .anchorRecord(recordIdHash, recordHash, ethers.ZeroHash, 0);

    expect(await memberRoleManager.hasRole(recordIdHash, trustee.address, 'owner')).to.equal(true);

    // Unanchor triggers retractTrusteeGrantsOnUnanchor — trustee should be downgraded back to
    // their independent viewer baseline, not stripped to nothing.
    await healthRecordCore.connect(subject).unanchorRecord(recordIdHash, ethers.ZeroHash);

    expect(await memberRoleManager.hasActiveRole(recordIdHash, trustee.address)).to.equal(true);
    expect(await memberRoleManager.hasRole(recordIdHash, trustee.address, 'viewer')).to.equal(true);
  });

  it('does not touch a trustee’s independent access when the subject unanchors', async function () {
    const recordIdHash = ethers.id('record-2');
    const recordHash = ethers.id('content-2');

    // Trustee independently initialized as this record's first owner — unrelated to the
    // trust relationship entirely.
    await memberRoleManager
      .connect(admin)
      .initializeRecordRole(recordIdHash, trustee.address, 'owner');

    // Trustee (as owner) grants the subject their own independent role
    await memberRoleManager.connect(trustee).grantRole(recordIdHash, subject.address, 'sharer');

    await memberRoleManager.connect(admin).bootstrapDependentTrustee(subjectIdHash, trusteeIdHash);

    // Anchor — extendTrusteeGrantsOnAnchor should skip the trustee since they already hold an
    // active role here, so it's never tracked as trustee-derived
    await healthRecordCore
      .connect(subject)
      .anchorRecord(recordIdHash, recordHash, ethers.ZeroHash, 0);

    expect(await memberRoleManager.hasRole(recordIdHash, trustee.address, 'owner')).to.equal(true);

    // Unanchor — retractTrusteeGrantsOnUnanchor should also skip, since it was never tracked as
    // trustee-derived. Trustee keeps their independent 'owner' role untouched.
    await healthRecordCore.connect(subject).unanchorRecord(recordIdHash, ethers.ZeroHash);

    expect(await memberRoleManager.hasRole(recordIdHash, trustee.address, 'owner')).to.equal(true);
  });
});
