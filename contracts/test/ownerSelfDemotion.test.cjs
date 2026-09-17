const { expect } = require('chai');
const { ethers, upgrades } = require('hardhat');
const { anyValue } = require('@nomicfoundation/hardhat-chai-matchers/withArgs');

describe('Owner voluntarily demoting themselves', function () {
  let memberRoleManager;
  let healthRecordCore;
  let admin, owner, otherOwner, otherAdmin;

  const ownerIdHash = ethers.id('owner-uid');
  const otherOwnerIdHash = ethers.id('other-owner-uid');
  const otherAdminIdHash = ethers.id('other-admin-uid');

  beforeEach(async function () {
    [admin, owner, otherOwner, otherAdmin] = await ethers.getSigners();

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
    await memberRoleManager.connect(admin).addMember(otherOwner.address, otherOwnerIdHash);
    await memberRoleManager.connect(admin).addMember(otherAdmin.address, otherAdminIdHash);
  });

  it('demotes an owner to administrator in one transaction when another owner exists', async function () {
    const recordIdHash = ethers.id('record-admin-demote');

    await memberRoleManager
      .connect(admin)
      .initializeRecordRole(recordIdHash, owner.address, 'owner');
    await memberRoleManager
      .connect(owner)
      .grantRole(recordIdHash, otherOwner.address, 'owner');

    await expect(
      memberRoleManager.connect(owner).voluntarilyLeaveOwnership(recordIdHash, 'administrator')
    )
      .to.emit(memberRoleManager, 'RoleChanged')
      .withArgs(recordIdHash, ownerIdHash, 'owner', 'administrator', ownerIdHash, anyValue);

    expect(await memberRoleManager.hasRole(recordIdHash, owner.address, 'owner')).to.equal(false);
    expect(await memberRoleManager.hasRole(recordIdHash, owner.address, 'administrator')).to.equal(
      true
    );
  });

  it('demotes an owner to sharer when an administrator exists', async function () {
    const recordIdHash = ethers.id('record-sharer-demote');

    await memberRoleManager
      .connect(admin)
      .initializeRecordRole(recordIdHash, owner.address, 'owner');
    await memberRoleManager
      .connect(owner)
      .grantRole(recordIdHash, otherAdmin.address, 'administrator');

    await memberRoleManager.connect(owner).voluntarilyLeaveOwnership(recordIdHash, 'sharer');

    expect(await memberRoleManager.hasRole(recordIdHash, owner.address, 'sharer')).to.equal(true);
  });

  it('demotes an owner to viewer when an administrator exists', async function () {
    const recordIdHash = ethers.id('record-viewer-demote');

    await memberRoleManager
      .connect(admin)
      .initializeRecordRole(recordIdHash, owner.address, 'owner');
    await memberRoleManager
      .connect(owner)
      .grantRole(recordIdHash, otherAdmin.address, 'administrator');

    await memberRoleManager.connect(owner).voluntarilyLeaveOwnership(recordIdHash, 'viewer');

    expect(await memberRoleManager.hasRole(recordIdHash, owner.address, 'viewer')).to.equal(true);
  });

  it('still fully leaves with no replacement role when newRole is empty (regression)', async function () {
    const recordIdHash = ethers.id('record-full-leave');

    await memberRoleManager
      .connect(admin)
      .initializeRecordRole(recordIdHash, owner.address, 'owner');
    await memberRoleManager
      .connect(owner)
      .grantRole(recordIdHash, otherAdmin.address, 'administrator');

    await expect(memberRoleManager.connect(owner).voluntarilyLeaveOwnership(recordIdHash, ''))
      .to.emit(memberRoleManager, 'OwnershipVoluntarilyLeft')
      .withArgs(recordIdHash, ownerIdHash, anyValue);

    expect(await memberRoleManager.hasActiveRole(recordIdHash, owner.address)).to.equal(false);
  });

  it('still blocks the sole owner with no administrators from leaving or demoting to a non-administrator role (regression guard for #808)', async function () {
    const recordIdHash = ethers.id('record-last-owner');

    await memberRoleManager
      .connect(admin)
      .initializeRecordRole(recordIdHash, owner.address, 'owner');

    await expect(
      memberRoleManager.connect(owner).voluntarilyLeaveOwnership(recordIdHash, '')
    ).to.be.revertedWith('Cannot leave as last owner with no administrators');

    await expect(
      memberRoleManager.connect(owner).voluntarilyLeaveOwnership(recordIdHash, 'sharer')
    ).to.be.revertedWith('Cannot leave as last owner with no administrators');

    await expect(
      memberRoleManager.connect(owner).voluntarilyLeaveOwnership(recordIdHash, 'viewer')
    ).to.be.revertedWith('Cannot leave as last owner with no administrators');
  });

  it('allows the sole owner with no administrators to demote themselves to administrator (#808)', async function () {
    // Before the fix, this reverted: the precondition checked hasOtherOwners/hasAdmins BEFORE
    // newRole is applied via _applyChangeRole, so it never credited the caller's own incoming
    // administrator role — the sole owner had no way to demote themselves without an existing
    // administrator already in place, even though becoming that administrator is exactly what
    // this call does.
    const recordIdHash = ethers.id('record-sole-owner-self-admin');

    await memberRoleManager
      .connect(admin)
      .initializeRecordRole(recordIdHash, owner.address, 'owner');

    await expect(
      memberRoleManager.connect(owner).voluntarilyLeaveOwnership(recordIdHash, 'administrator')
    )
      .to.emit(memberRoleManager, 'RoleChanged')
      .withArgs(recordIdHash, ownerIdHash, 'owner', 'administrator', ownerIdHash, anyValue);

    expect(await memberRoleManager.hasRole(recordIdHash, owner.address, 'owner')).to.equal(false);
    expect(await memberRoleManager.hasRole(recordIdHash, owner.address, 'administrator')).to.equal(
      true
    );
  });

  it('rejects passing "owner" as the replacement role', async function () {
    const recordIdHash = ethers.id('record-owner-noop');

    await memberRoleManager
      .connect(admin)
      .initializeRecordRole(recordIdHash, owner.address, 'owner');
    await memberRoleManager
      .connect(owner)
      .grantRole(recordIdHash, otherAdmin.address, 'administrator');

    await expect(
      memberRoleManager.connect(owner).voluntarilyLeaveOwnership(recordIdHash, 'owner')
    ).to.be.revertedWith("Use an empty string to leave entirely, not 'owner'");
  });

  it('blocks demoting an active subject-owner below sharer, but allows sharer', async function () {
    const recordIdHash = ethers.id('record-subject-owner');
    const recordHash = ethers.id('content-subject-owner');

    await memberRoleManager
      .connect(admin)
      .initializeRecordRole(recordIdHash, owner.address, 'owner');
    await memberRoleManager
      .connect(owner)
      .grantRole(recordIdHash, otherAdmin.address, 'administrator');

    // Owner anchors the record with themselves as the subject
    await healthRecordCore
      .connect(owner)
      .anchorRecord(recordIdHash, recordHash, ethers.ZeroHash, 0);

    await expect(
      memberRoleManager.connect(owner).voluntarilyLeaveOwnership(recordIdHash, 'viewer')
    ).to.be.revertedWith('Cannot demote an active subject below sharer');

    // Sharer is the floor for an active subject — this should succeed
    await memberRoleManager.connect(owner).voluntarilyLeaveOwnership(recordIdHash, 'sharer');
    expect(await memberRoleManager.hasRole(recordIdHash, owner.address, 'sharer')).to.equal(true);
  });
});
