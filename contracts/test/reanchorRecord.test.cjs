const { expect } = require('chai');
const { ethers, upgrades } = require('hardhat');
const { anyValue } = require('@nomicfoundation/hardhat-chai-matchers/withArgs');

// Regression coverage for #816: reanchorRecord used to emit its own RecordReanchored event —
// redundant with RecordAnchored since, from the end-state's perspective, a reanchor and an
// anchor are indistinguishable (isSubjectActive is true either way). Consolidated to emit
// RecordAnchored instead, carrying the record's current hash (reanchorRecord takes no hash
// argument itself, since a reanchor never changes which hash the subject is confirming).
describe('HealthRecordCore.reanchorRecord', function () {
  let memberRoleManager;
  let healthRecordCore;
  let admin, owner;

  const ownerIdHash = ethers.id('reanchor-owner-uid');

  beforeEach(async function () {
    [admin, owner] = await ethers.getSigners();

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
    await memberRoleManager.connect(admin).addMember(owner.address, ownerIdHash);
  });

  it('emits RecordAnchored (not RecordReanchored) with the record’s current hash on reanchor', async function () {
    const recordIdHash = ethers.id('reanchor-record-1');
    const recordHash = ethers.id('reanchor-content-1');

    await memberRoleManager
      .connect(admin)
      .initializeRecordRole(recordIdHash, owner.address, 'owner');

    await healthRecordCore.connect(owner).anchorRecord(recordIdHash, recordHash, ethers.ZeroHash, 0);
    await healthRecordCore.connect(owner).unanchorRecord(recordIdHash, ethers.ZeroHash);

    await expect(healthRecordCore.connect(owner).reanchorRecord(recordIdHash, ethers.ZeroHash, 0))
      .to.emit(healthRecordCore, 'RecordAnchored')
      .withArgs(recordIdHash, recordHash, ownerIdHash, anyValue);

    // No RecordReanchored event exists on the contract at all anymore.
    expect(healthRecordCore.interface.getEvent('RecordReanchored')).to.equal(null);

    expect(await healthRecordCore.isActiveSubject(recordIdHash, ownerIdHash)).to.equal(true);
  });

  it('reverts with "Was never a subject" when reanchoring a subject who was never anchored', async function () {
    const recordIdHash = ethers.id('reanchor-record-2');

    await memberRoleManager
      .connect(admin)
      .initializeRecordRole(recordIdHash, owner.address, 'owner');

    await expect(
      healthRecordCore.connect(owner).reanchorRecord(recordIdHash, ethers.ZeroHash, 0)
    ).to.be.revertedWith('Was never a subject');
  });

  it('reverts with "Already active" when reanchoring a subject who is currently anchored', async function () {
    const recordIdHash = ethers.id('reanchor-record-3');
    const recordHash = ethers.id('reanchor-content-3');

    await memberRoleManager
      .connect(admin)
      .initializeRecordRole(recordIdHash, owner.address, 'owner');
    await healthRecordCore.connect(owner).anchorRecord(recordIdHash, recordHash, ethers.ZeroHash, 0);

    await expect(
      healthRecordCore.connect(owner).reanchorRecord(recordIdHash, ethers.ZeroHash, 0)
    ).to.be.revertedWith('Already active');
  });

  it('self-verifies at the given level on reanchor, same as anchorRecord (#816 follow-up)', async function () {
    const recordIdHash = ethers.id('reanchor-record-4');
    const recordHash = ethers.id('reanchor-content-4');

    await memberRoleManager
      .connect(admin)
      .initializeRecordRole(recordIdHash, owner.address, 'owner');
    // selfVerifyLevel: 0 on the initial anchor so the reanchor's own self-verify is what's
    // actually under test, not a carry-over from anchoring.
    await healthRecordCore.connect(owner).anchorRecord(recordIdHash, recordHash, ethers.ZeroHash, 0);
    await healthRecordCore.connect(owner).unanchorRecord(recordIdHash, ethers.ZeroHash);

    expect(await healthRecordCore.currentlyVerified(recordHash, ownerIdHash)).to.equal(false);

    await expect(healthRecordCore.connect(owner).reanchorRecord(recordIdHash, ethers.ZeroHash, 3))
      .to.emit(healthRecordCore, 'RecordVerified')
      .withArgs(recordHash, recordIdHash, ownerIdHash, 3, anyValue);

    expect(await healthRecordCore.currentlyVerified(recordHash, ownerIdHash)).to.equal(true);
  });

  it('does not self-verify on reanchor when selfVerifyLevel is 0 (opt-out)', async function () {
    const recordIdHash = ethers.id('reanchor-record-5');
    const recordHash = ethers.id('reanchor-content-5');

    await memberRoleManager
      .connect(admin)
      .initializeRecordRole(recordIdHash, owner.address, 'owner');
    await healthRecordCore.connect(owner).anchorRecord(recordIdHash, recordHash, ethers.ZeroHash, 0);
    await healthRecordCore.connect(owner).unanchorRecord(recordIdHash, ethers.ZeroHash);

    await healthRecordCore.connect(owner).reanchorRecord(recordIdHash, ethers.ZeroHash, 0);

    expect(await healthRecordCore.currentlyVerified(recordHash, ownerIdHash)).to.equal(false);
  });

  it('does not revert reanchor when self-verify would fail its own guard (already verified)', async function () {
    // _maybeSelfVerify silently no-ops on guard failure rather than reverting — the nudge must
    // never block the reanchor itself. Verifying independently first, then reanchoring, exercises
    // that no-op path (currentlyVerified is already true going in).
    const recordIdHash = ethers.id('reanchor-record-6');
    const recordHash = ethers.id('reanchor-content-6');

    await memberRoleManager
      .connect(admin)
      .initializeRecordRole(recordIdHash, owner.address, 'owner');
    await healthRecordCore.connect(owner).anchorRecord(recordIdHash, recordHash, ethers.ZeroHash, 0);
    await healthRecordCore.connect(owner).unanchorRecord(recordIdHash, ethers.ZeroHash);
    await healthRecordCore.connect(owner).verifyRecord(recordIdHash, recordHash, 2);

    await expect(healthRecordCore.connect(owner).reanchorRecord(recordIdHash, ethers.ZeroHash, 3))
      .to.not.emit(healthRecordCore, 'RecordVerified');

    expect(await healthRecordCore.isActiveSubject(recordIdHash, ownerIdHash)).to.equal(true);
  });
});
