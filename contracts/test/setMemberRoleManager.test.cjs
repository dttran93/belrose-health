const { expect } = require('chai');
const { ethers, upgrades } = require('hardhat');
const { anyValue } = require('@nomicfoundation/hardhat-chai-matchers/withArgs');

// Regression test: setMemberRoleManager previously updated state but emitted no event at all —
// a contract-level blind spot for the chain event indexer (it has no way to reconcile a change
// it's never told about), unlike MemberRoleManager.sol's symmetric setHealthRecordCore, which
// already emits HealthRecordCoreUpdated. Fixed by adding MemberRoleManagerUpdated, mirroring
// that event's shape exactly. Adding an event never affects storage layout (events aren't part
// of contract storage — only the OZ upgrade plugin's state-variable layout check matters for
// that), so this required no special upgrade-safety handling beyond the usual UUPS upgrade flow.
describe('HealthRecordCore.setMemberRoleManager', function () {
  let memberRoleManager;
  let healthRecordCore;
  let admin, other;

  beforeEach(async function () {
    [admin, other] = await ethers.getSigners();

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
  });

  it('emits MemberRoleManagerUpdated with the new address', async function () {
    const NewMemberRoleManager = await ethers.getContractFactory('MemberRoleManager', admin);
    const newMemberRoleManager = await upgrades.deployProxy(NewMemberRoleManager, [], {
      kind: 'uups',
    });
    await newMemberRoleManager.waitForDeployment();
    const newAddress = await newMemberRoleManager.getAddress();

    await expect(healthRecordCore.connect(admin).setMemberRoleManager(newAddress))
      .to.emit(healthRecordCore, 'MemberRoleManagerUpdated')
      .withArgs(newAddress, anyValue);

    expect(await healthRecordCore.memberRoleManager()).to.equal(newAddress);
  });

  it('reverts with the zero address', async function () {
    await expect(
      healthRecordCore.connect(admin).setMemberRoleManager(ethers.ZeroAddress)
    ).to.be.revertedWith('Invalid address');
  });

  it('reverts when called by anyone other than admin', async function () {
    await expect(
      healthRecordCore.connect(other).setMemberRoleManager(other.address)
    ).to.be.revertedWith('Only admin');
  });
});
