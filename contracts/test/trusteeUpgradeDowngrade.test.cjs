const { expect } = require('chai');
const { ethers, upgrades } = require('hardhat');

describe('Trustee strip-vs-downgrade on propose/accept/revoke/decline', function () {
  let memberRoleManager;
  let admin, trustor, trustee;

  const trustorIdHash = ethers.id('trustor-uid');
  const trusteeIdHash = ethers.id('trustee-uid');
  const TrusteeLevel = { Observer: 0, Custodian: 1, Controller: 2 };

  beforeEach(async function () {
    [admin, trustor, trustee] = await ethers.getSigners();

    const MemberRoleManager = await ethers.getContractFactory('MemberRoleManager', admin);
    memberRoleManager = await upgrades.deployProxy(MemberRoleManager, [], { kind: 'uups' });
    await memberRoleManager.waitForDeployment();

    await memberRoleManager.connect(admin).addMember(trustor.address, trustorIdHash);
    await memberRoleManager.connect(admin).addMember(trustee.address, trusteeIdHash);
  });

  it('strips a fresh grant entirely when the trustee had no independent access, on revoke', async function () {
    const recordIdHash = ethers.id('record-fresh');
    await memberRoleManager
      .connect(admin)
      .initializeRecordRole(recordIdHash, trustor.address, 'owner');

    await memberRoleManager
      .connect(trustor)
      .proposeTrustee(trusteeIdHash, TrusteeLevel.Controller, [recordIdHash]);
    expect(await memberRoleManager.hasRole(recordIdHash, trustee.address, 'owner')).to.equal(true);

    await memberRoleManager.connect(trustee).acceptTrustee(trustorIdHash);
    await memberRoleManager.connect(trustor).revokeTrustee(trustorIdHash, trusteeIdHash);

    expect(await memberRoleManager.hasActiveRole(recordIdHash, trustee.address)).to.equal(false);
  });

  it('upgrades a trustee with lower independent access on propose, and downgrades back to it on revoke', async function () {
    const recordIdHash = ethers.id('record-upgrade');
    await memberRoleManager
      .connect(admin)
      .initializeRecordRole(recordIdHash, trustor.address, 'owner');
    // Trustee already has independent viewer access, unrelated to the trust relationship.
    await memberRoleManager.connect(trustor).grantRole(recordIdHash, trustee.address, 'viewer');

    await memberRoleManager
      .connect(trustor)
      .proposeTrustee(trusteeIdHash, TrusteeLevel.Controller, [recordIdHash]);

    // Upgraded to owner immediately at propose time (mirrors the trustor's role)
    expect(await memberRoleManager.hasRole(recordIdHash, trustee.address, 'owner')).to.equal(true);

    await memberRoleManager.connect(trustee).acceptTrustee(trustorIdHash);
    await memberRoleManager.connect(trustor).revokeTrustee(trustorIdHash, trusteeIdHash);

    // Downgraded back to the independent viewer baseline — not stripped to nothing.
    expect(await memberRoleManager.hasActiveRole(recordIdHash, trustee.address)).to.equal(true);
    expect(await memberRoleManager.hasRole(recordIdHash, trustee.address, 'viewer')).to.equal(true);
  });

  it('downgrades back to the independent baseline when a pending proposal with an upgrade is declined', async function () {
    const recordIdHash = ethers.id('record-decline');
    await memberRoleManager
      .connect(admin)
      .initializeRecordRole(recordIdHash, trustor.address, 'owner');
    await memberRoleManager.connect(trustor).grantRole(recordIdHash, trustee.address, 'viewer');

    await memberRoleManager
      .connect(trustor)
      .proposeTrustee(trusteeIdHash, TrusteeLevel.Controller, [recordIdHash]);
    expect(await memberRoleManager.hasRole(recordIdHash, trustee.address, 'owner')).to.equal(true);

    // Trustee declines before ever accepting.
    await memberRoleManager.connect(trustee).declineTrustee(trustorIdHash);

    expect(await memberRoleManager.hasActiveRole(recordIdHash, trustee.address)).to.equal(true);
    expect(await memberRoleManager.hasRole(recordIdHash, trustee.address, 'viewer')).to.equal(true);
  });

  it('does not upgrade a trustee who already holds an equal-or-higher role', async function () {
    const recordIdHash = ethers.id('record-no-upgrade');
    await memberRoleManager
      .connect(admin)
      .initializeRecordRole(recordIdHash, trustor.address, 'owner');
    // Trustee already independently an administrator — higher rank than what Custodian would
    // resolve to (administrator, capped) — should be left untouched, not "upgraded" sideways.
    await memberRoleManager
      .connect(trustor)
      .grantRole(recordIdHash, trustee.address, 'administrator');

    await memberRoleManager
      .connect(trustor)
      .proposeTrustee(trusteeIdHash, TrusteeLevel.Custodian, [recordIdHash]);

    expect(await memberRoleManager.hasRole(recordIdHash, trustee.address, 'administrator')).to.equal(
      true
    );

    // Since it was never tracked as trustee-derived (no upgrade occurred), revoking the
    // relationship must leave the independent role fully untouched.
    await memberRoleManager.connect(trustee).acceptTrustee(trustorIdHash);
    await memberRoleManager.connect(trustor).revokeTrustee(trustorIdHash, trusteeIdHash);

    expect(await memberRoleManager.hasRole(recordIdHash, trustee.address, 'administrator')).to.equal(
      true
    );
  });
});
