// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

/**
 * @title MemberRoleManagerInterface
 * @dev Interface for HealthRecordCore to reference
 */
interface MemberRoleManagerInterface {
  function isActiveMember(address wallet) external view returns (bool);

  function isVerifiedMember(address wallet) external view returns (bool);

  function isVerifiedProvider(address wallet) external view returns (bool);

  function hasActiveRole(bytes32 recordIdHash, address wallet) external view returns (bool);

  function hasRole(
    bytes32 recordIdHash,
    address wallet,
    string memory role
  ) external view returns (bool);

  function isOwnerOrAdmin(bytes32 recordIdHash, address wallet) external view returns (bool);

  function getUserForWallet(address wallet) external view returns (bytes32);

  function isControllerOf(
    bytes32 trustorIdHash,
    bytes32 controllerIdHash
  ) external view returns (bool);
}

/**
 * @title HealthRecordCoreInterface
 * @dev Interface for MemberRoleManager to check subject status
 */
interface HealthRecordCoreInterface {
  function isActiveSubject(bytes32 recordIdHash, bytes32 userIdHash) external view returns (bool);
}

/**
 * @title MemberRoleManager
 * @dev Manages multi-wallet member registration and role-based access control.
 * @dev Upgradeable version using uups proxy pattern
 *
 * KEY ARCHITECTURE:
 * - Members are registered by WALLET ADDRESS
 * - Each wallet is linked to an IDENTITY (userIdHash)
 * - One identity can have MULTIPLE wallets (EOA, Smart Account, etc.)
 * - Roles are assigned to IDENTITIES, not wallets
 * - Any wallet linked to an identity can exercise that identity's roles
 */
contract MemberRoleManager is Initializable, UUPSUpgradeable, MemberRoleManagerInterface {
  // ===============================================================
  // ADMIN MANAGEMENT
  // ===============================================================
  address public admin;

  event AdminTransferred(address indexed oldAdmin, address indexed newAdmin, uint256 timestamp);

  modifier onlyAdmin() {
    require(msg.sender == admin, "Only admin");
    _;
  }

  modifier onlyActiveMember() {
    require(_isActiveMember(msg.sender), "Not an active member");
    _;
  }

  modifier onlyVerifiedMember() {
    require(_isVerifiedMember(msg.sender), "Not a verified member");
    _;
  }

  modifier onlyVerifiedProvider() {
    require(_isVerifiedProvider(msg.sender), "Not a verified provider");
    _;
  }

  /// @custom:oz-upgrades-unsafe-allow constructor
  constructor() {
    _disableInitializers();
  }

  /**
   * @notice Initialize the contract (replaces constructor)
   * @dev Can only be called once during proxy deployment
   */
  function initialize() public initializer {
    admin = msg.sender;
  }

  /**
   * @notice Authorize contract upgrades
   * @dev Only admin can upgrade the contract
   */
  function _authorizeUpgrade(address newImplementation) internal override onlyAdmin {}

  function transferAdmin(address newAdmin) external onlyAdmin {
    require(newAdmin != address(0), "Invalid address");
    emit AdminTransferred(admin, newAdmin, block.timestamp);
    admin = newAdmin;
  }

  /**
   * @notice Update the HealthRecordCore reference
   * @dev Only admin can update this
   * @param _healthRecordCore Address of the HealthRecordCore contract
   */
  function setHealthRecordCore(address _healthRecordCore) external onlyAdmin {
    require(_healthRecordCore != address(0), "Invalid address");
    healthRecordCore = HealthRecordCoreInterface(_healthRecordCore);
    emit HealthRecordCoreUpdated(_healthRecordCore, block.timestamp);
  }

  // ===============================================================
  // MEMBER REGISTRY
  // ===============================================================

  // =================== MEMBER REGISTRY - ENUMS ===================

  enum MemberStatus {
    NotRegistered, // 0 - Default/uninitialized
    Inactive, // 1 - Cannot transact (banned/removed)
    Active, // 2 - Default for new members
    Verified, // 3 - User has verified their identity and email
    VerifiedProvider // 4 - User is a verified healthcare provider
  }

  // =================== MEMBER REGISTRY - EVENTS ===================

  event MemberRegistered(address indexed wallet, bytes32 indexed userIdHash, uint256 timestamp);

  event WalletLinked(address indexed wallet, bytes32 indexed userIdHash, uint256 timestamp);

  event MemberStatusChanged(
    bytes32 indexed userIdHash,
    MemberStatus oldStatus,
    MemberStatus newStatus,
    address indexed changedBy,
    uint256 timestamp
  );

  // =================== MEMBER REGISTRY - STRUCTURE ===================

  // Wallet's Member info - maps a wallet to its identity (userIdHash)
  struct UserInfo {
    bytes32 userIdHash; // The identity this wallet belongs to
    bool isWalletActive; // Whether this wallet can be used
  }

  // =================== MEMBER REGISTRY - STORAGE ===================

  // Map address to UserIdHash and status (whether wallet is active or not)
  mapping(address => UserInfo) public wallets;

  // map userIdHash with memberStatus
  mapping(bytes32 => MemberStatus) public userStatus;

  // Identity (userIdHash) => list of wallet addresses
  mapping(bytes32 => address[]) public userWallets;

  uint256 public totalUsers;

  // =================== MEMBER REGISTRY - FUNCTIONS ===================

  /**
   * @notice Register a new wallet for an identity (can only be called by Admin)
   * @dev If this is the first wallet for this userIdHash, creates the identity
   * @param wallet The wallet address to register
   * @param userIdHash Hash of their off-chain user ID
   */
  function addMember(address wallet, bytes32 userIdHash) external onlyAdmin {
    require(wallet != address(0), "Invalid wallet address");
    require(userIdHash != bytes32(0), "Invalid user ID hash");
    require(wallets[wallet].userIdHash == bytes32(0), "Wallet already registered");

    // Link wallet to user
    wallets[wallet] = UserInfo({ userIdHash: userIdHash, isWalletActive: true });

    // Add to user's's wallet list
    userWallets[userIdHash].push(wallet);

    // If new user, initialize active status
    if (userStatus[userIdHash] == MemberStatus.NotRegistered) {
      userStatus[userIdHash] = MemberStatus.Active;
      totalUsers++;

      emit MemberRegistered(wallet, userIdHash, block.timestamp);
    } else {
      emit WalletLinked(wallet, userIdHash, block.timestamp);
    }
  }

  /**
   * @notice Register multiple wallets for the same identity in one transaction
   * @dev Useful for initial registration where EOA + smart account are known upfront
   * @param walletAddresses Array of wallet addresses to register
   * @param userIdHash The identity to link them all to
   */
  function addMemberBatch(
    address[] calldata walletAddresses,
    bytes32 userIdHash
  ) external onlyAdmin {
    require(walletAddresses.length > 0, "No wallets provided");
    require(userIdHash != bytes32(0), "Invalid user ID hash");

    bool isNewUser = userStatus[userIdHash] == MemberStatus.NotRegistered;

    for (uint256 i = 0; i < walletAddresses.length; i++) {
      address wallet = walletAddresses[i];
      require(wallet != address(0), "Invalid wallet address");
      require(wallets[wallet].userIdHash == bytes32(0), "Wallet already registered");

      wallets[wallet] = UserInfo({ userIdHash: userIdHash, isWalletActive: true });
      userWallets[userIdHash].push(wallet);

      if (i == 0 && isNewUser) {
        // First wallet of a new user — initialize identity
        userStatus[userIdHash] = MemberStatus.Active;
        totalUsers++;
        emit MemberRegistered(wallet, userIdHash, block.timestamp);
      } else {
        emit WalletLinked(wallet, userIdHash, block.timestamp);
      }
    }
  }

  /**
   * @notice Change an identity's status (affects all their wallets)
   * @param userIdHash The identity to update
   * @param newStatus The new status
   */
  function setUserStatus(bytes32 userIdHash, MemberStatus newStatus) external onlyAdmin {
    require(userStatus[userIdHash] != MemberStatus.NotRegistered, "User not registered");

    MemberStatus oldStatus = userStatus[userIdHash];
    require(oldStatus != newStatus, "Already this status");

    userStatus[userIdHash] = newStatus;

    emit MemberStatusChanged(userIdHash, oldStatus, newStatus, msg.sender, block.timestamp);
  }

  /**
   * @notice Deactivate a specific wallet (not the whole user)
   * @param wallet The wallet to deactivate
   */
  function deactivateWallet(address wallet) external onlyAdmin {
    require(wallets[wallet].userIdHash != bytes32(0), "Wallet not registered");
    require(wallets[wallet].isWalletActive, "Wallet already inactive");

    wallets[wallet].isWalletActive = false;
  }

  /**
   * @notice Reactivate a specific wallet
   * @param wallet The wallet to reactivate
   */
  function reactivateWallet(address wallet) external onlyAdmin {
    require(wallets[wallet].userIdHash != bytes32(0), "Wallet not registered");
    require(!wallets[wallet].isWalletActive, "Wallet already active");

    wallets[wallet].isWalletActive = true;
  }

  // =================== MEMBER REGISTRY - VIEW FUNCTIONS ===================

  /**
   * @notice Check if wallet belongs to an active member
   */
  function isActiveMember(address wallet) external view override returns (bool) {
    return _isActiveMember(wallet);
  }

  function _isActiveMember(address wallet) internal view returns (bool) {
    bytes32 userIdHash = wallets[wallet].userIdHash;
    if (userIdHash == bytes32(0) || !wallets[wallet].isWalletActive) return false;

    MemberStatus status = userStatus[userIdHash];
    return
      status == MemberStatus.Active ||
      status == MemberStatus.Verified ||
      status == MemberStatus.VerifiedProvider;
  }

  /**
   * @notice Check if wallet belongs to a verified member
   */
  function isVerifiedMember(address wallet) external view override returns (bool) {
    return _isVerifiedMember(wallet);
  }

  function _isVerifiedMember(address wallet) internal view returns (bool) {
    bytes32 userIdHash = wallets[wallet].userIdHash;
    if (userIdHash == bytes32(0) || !wallets[wallet].isWalletActive) return false;

    return userStatus[userIdHash] == MemberStatus.Verified;
  }

  /**
   * @notice Check if wallet belongs to a verified healthcare provider
   */
  function isVerifiedProvider(address wallet) external view override returns (bool) {
    return _isVerifiedProvider(wallet);
  }

  function _isVerifiedProvider(address wallet) internal view returns (bool) {
    bytes32 userIdHash = wallets[wallet].userIdHash;
    if (userIdHash == bytes32(0) || !wallets[wallet].isWalletActive) return false;

    return userStatus[userIdHash] == MemberStatus.VerifiedProvider;
  }

  /**
   * @notice Get the identity (userIdHash) for a wallet
   */
  function getUserForWallet(address wallet) external view returns (bytes32) {
    return wallets[wallet].userIdHash;
  }

  /**
   * @notice Get all wallets for an identity
   */
  function getWalletsForUser(bytes32 userIdHash) external view returns (address[] memory) {
    return userWallets[userIdHash];
  }

  /**
   * @notice Get user status (not registered, inactive, active, verified)
   */
  function getUserStatus(bytes32 userIdHash) external view returns (MemberStatus status) {
    return userStatus[userIdHash];
  }

  /**
   * @notice Get total number of identities
   */
  function getTotalUsers() external view returns (uint256) {
    return totalUsers;
  }

  // ===============================================================
  // ROLE MANAGEMENT
  // ===============================================================

  // =================== ROLE MANAGEMENT - EVENTS ===================

  event RoleGranted(
    bytes32 indexed recordIdHash,
    bytes32 indexed targetIdHash,
    string role,
    bytes32 indexed userIdHash,
    uint256 timestamp
  );

  event RoleChanged(
    bytes32 indexed recordIdHash,
    bytes32 indexed targetIdHash,
    string oldRole,
    string newRole,
    bytes32 indexed userIdHash,
    uint256 timestamp
  );

  event RoleRevoked(
    bytes32 indexed recordIdHash,
    bytes32 indexed targetIdHash,
    string role,
    bytes32 indexed userIdHash,
    uint256 timestamp
  );

  event OwnershipVoluntarilyLeft(
    bytes32 indexed recordIdHash,
    bytes32 indexed userIdHash,
    uint256 timestamp
  );

  event HealthRecordCoreUpdated(address indexed newAddress, uint256 timestamp);

  // =================== ROLE MANAGEMENT - STRUCTURE ===================

  struct RecordRole {
    string role; // "owner", "administrator", "sharer", "viewer"
    bool isActive;
  }

  // =================== ROLE MANAGEMENT - STORAGE ===================

  // hash of recordIdHash and userIdHash => RecordRole
  mapping(bytes32 => RecordRole) public recordRoles;

  // recordIdHash => list of identity hashes with each role type
  mapping(bytes32 => bytes32[]) public ownersByRecord;
  mapping(bytes32 => bytes32[]) public adminsByRecord;
  mapping(bytes32 => bytes32[]) public sharersByRecord;
  mapping(bytes32 => bytes32[]) public viewersByRecord;

  HealthRecordCoreInterface public healthRecordCore;
  mapping(bytes32 => bytes32) public roleGrantedBy;

  // =================== ROLE MANAGEMENT - INTERNAL HELPERS ===================

  /**
   * @dev Get the role key for a (recordIdHash, userIdHash) pair
   */
  function _getRoleKey(bytes32 recordIdHash, bytes32 userIdHash) internal pure returns (bytes32) {
    return keccak256(abi.encodePacked(recordIdHash, userIdHash));
  }

  /**
   * @dev Get caller's identity hash
   */
  function _getCallerIdHash() internal view returns (bytes32) {
    return wallets[msg.sender].userIdHash;
  }

  /**
   * @dev Makes sure the role is a valid role
   */
  function _isValidRole(string memory role) internal pure returns (bool) {
    bytes32 h = keccak256(bytes(role));
    return (h == keccak256(bytes("owner")) ||
      h == keccak256(bytes("administrator")) ||
      h == keccak256(bytes("sharer")) ||
      h == keccak256(bytes("viewer")));
  }

  function _isSharerOrAbove(bytes32 recordIdHash, bytes32 userIdHash) internal view returns (bool) {
    return
      _hasRole(recordIdHash, userIdHash, "sharer") ||
      _hasRole(recordIdHash, userIdHash, "administrator") ||
      _hasRole(recordIdHash, userIdHash, "owner");
  }

  function _grantRoleInternal(
    bytes32 recordIdHash,
    bytes32 targetIdHash,
    string memory role,
    bytes32 userIdHash
  ) internal {
    bytes32 roleKey = _getRoleKey(recordIdHash, targetIdHash);

    RecordRole storage currentEntry = recordRoles[roleKey];
    string memory oldRole = currentEntry.role;
    bool isCurrentlyActive = currentEntry.isActive;

    recordRoles[roleKey] = RecordRole({ role: role, isActive: true });

    if (!isCurrentlyActive) {
      roleGrantedBy[roleKey] = userIdHash;
      _addToRoleArray(recordIdHash, targetIdHash, role);

      emit RoleGranted(recordIdHash, targetIdHash, role, userIdHash, block.timestamp);
    } else {
      if (keccak256(bytes(oldRole)) != keccak256(bytes(role))) {
        _removeFromRoleArray(recordIdHash, targetIdHash, oldRole);
        _addToRoleArray(recordIdHash, targetIdHash, role);
      }
    }
  }

  function _addToRoleArray(bytes32 recordIdHash, bytes32 userIdHash, string memory role) internal {
    bytes32 roleHash = keccak256(bytes(role));

    if (roleHash == keccak256(bytes("owner"))) {
      ownersByRecord[recordIdHash].push(userIdHash);
    } else if (roleHash == keccak256(bytes("administrator"))) {
      adminsByRecord[recordIdHash].push(userIdHash);
    } else if (roleHash == keccak256(bytes("sharer"))) {
      sharersByRecord[recordIdHash].push(userIdHash);
    } else if (roleHash == keccak256(bytes("viewer"))) {
      viewersByRecord[recordIdHash].push(userIdHash);
    }
  }

  function _removeFromRoleArray(
    bytes32 recordIdHash,
    bytes32 userIdHash,
    string memory role
  ) internal {
    bytes32 roleHash = keccak256(bytes(role));

    if (roleHash == keccak256(bytes("owner"))) {
      _removeFromBytes32Array(ownersByRecord[recordIdHash], userIdHash);
    } else if (roleHash == keccak256(bytes("administrator"))) {
      _removeFromBytes32Array(adminsByRecord[recordIdHash], userIdHash);
    } else if (roleHash == keccak256(bytes("sharer"))) {
      _removeFromBytes32Array(sharersByRecord[recordIdHash], userIdHash);
    } else if (roleHash == keccak256(bytes("viewer"))) {
      _removeFromBytes32Array(viewersByRecord[recordIdHash], userIdHash);
    }
  }

  function _removeFromBytes32Array(bytes32[] storage array, bytes32 toRemove) internal {
    for (uint256 i = 0; i < array.length; i++) {
      if (array[i] == toRemove) {
        array[i] = array[array.length - 1];
        array.pop();
        break;
      }
    }
  }

  function _hasActiveRole(bytes32 recordIdHash, bytes32 userIdHash) internal view returns (bool) {
    bytes32 roleKey = _getRoleKey(recordIdHash, userIdHash);
    return recordRoles[roleKey].isActive;
  }

  function _hasRole(
    bytes32 recordIdHash,
    bytes32 userIdHash,
    string memory role
  ) internal view returns (bool) {
    bytes32 roleKey = _getRoleKey(recordIdHash, userIdHash);
    RecordRole memory r = recordRoles[roleKey];
    return r.isActive && keccak256(bytes(r.role)) == keccak256(bytes(role));
  }

  function _isOwnerOrAdmin(bytes32 recordIdHash, bytes32 userIdHash) internal view returns (bool) {
    return
      _hasRole(recordIdHash, userIdHash, "owner") ||
      _hasRole(recordIdHash, userIdHash, "administrator");
  }

  /**
   * @dev Check if user is an active subject via HealthRecordCore
   * @dev Returns false if healthRecordCore is not set
   */
  function _isActiveSubject(bytes32 recordIdHash, bytes32 userIdHash) internal view returns (bool) {
    if (address(healthRecordCore) == address(0)) return false;
    return healthRecordCore.isActiveSubject(recordIdHash, userIdHash);
  }

  /**
   * @dev Get user's current role (returns empty string if no role)
   */
  function _getUserRole(
    bytes32 recordIdHash,
    bytes32 userIdHash
  ) internal view returns (string memory) {
    bytes32 roleKey = _getRoleKey(recordIdHash, userIdHash);
    RecordRole memory r = recordRoles[roleKey];
    return r.isActive ? r.role : "";
  }

  // =================== ROLE MANAGEMENT - EXTERNAL FUNCTIONS ===================

  /**
   * @notice Admin establishes first role (administrator or owner) on a new record
   * @param recordIdHash The recordIDHash
   * @param targetWallet A wallet address belonging to the user to assign the role to
   * @param role The role to assign ("administrator" or "owner")
   */
  function initializeRecordRole(
    bytes32 recordIdHash,
    address targetWallet,
    string memory role
  ) external onlyAdmin {
    require(recordIdHash != bytes32(0), "Record ID hash cannot be empty");
    require(targetWallet != address(0), "Invalid wallet address");
    require(_isValidRole(role), "Invalid role string");

    // Get the identity for this wallet
    bytes32 targetIdHash = wallets[targetWallet].userIdHash;
    require(targetIdHash != bytes32(0), "Wallet not registered");
    require(_isActiveMember(targetWallet), "Must be an active member");

    require(
      ownersByRecord[recordIdHash].length == 0 && adminsByRecord[recordIdHash].length == 0,
      "Record already initialized"
    );

    _grantRoleInternal(recordIdHash, targetIdHash, role, bytes32(0)); // bytes32(0) = admin
  }

  /**
   * @notice Grant a role to a user for a specific record
   * @param recordIdHash The record ID
   * @param targetWallet A wallet address belonging to the target user
   * @param role The role to grant ("owner", "administrator", "viewer")
   */
  function grantRole(
    bytes32 recordIdHash,
    address targetWallet,
    string memory role
  ) external onlyActiveMember {
    require(recordIdHash != bytes32(0), "Record ID hash cannot be empty");
    require(targetWallet != address(0), "Wallet address cannot be zero");
    require(_isValidRole(role), "Invalid role string");

    // Get identities
    bytes32 userIdHash = _getCallerIdHash();
    bytes32 targetIdHash = wallets[targetWallet].userIdHash;
    require(targetIdHash != bytes32(0), "Target wallet not registered");

    bytes32 roleHash = keccak256(bytes(role));

    require(_hasActiveRole(recordIdHash, userIdHash), "You have no role for this record");

    bool ownerExists = ownersByRecord[recordIdHash].length > 0;
    bool userIsOwner = _hasRole(recordIdHash, userIdHash, "owner");
    bool userIsAdmin = _hasRole(recordIdHash, userIdHash, "administrator");
    bool userIsSharer = _hasRole(recordIdHash, userIdHash, "sharer");

    if (roleHash == keccak256(bytes("owner"))) {
      if (ownerExists) {
        require(userIsOwner, "Only owners can grant owner role");
      } else {
        require(userIsAdmin, "Only administrators can grant first owner");
      }
    } else if (roleHash == keccak256(bytes("administrator"))) {
      require(
        userIsOwner || userIsAdmin,
        "Only owners and administrators can grant administrator role"
      );
    } else if (roleHash == keccak256(bytes("sharer"))) {
      require(userIsOwner || userIsAdmin, "Only owners and administrators can grant sharer role");
    } else if (roleHash == keccak256(bytes("viewer"))) {
      require(
        userIsOwner || userIsAdmin || userIsSharer,
        "Only owners, administrators, and sharers can grant viewer role"
      );
    }

    require(
      !_hasActiveRole(recordIdHash, targetIdHash),
      "Target already has a role. Use changeRole() instead"
    );

    _grantRoleInternal(recordIdHash, targetIdHash, role, userIdHash);
  }

  /**
   * @notice Change a user's existing role to a different role
   * @param recordIdHash The record ID Hash
   * @param targetWallet A wallet address belonging to the target user
   * @param newRole The new role ("owner", "administrator", "viewer")
   */
  function changeRole(
    bytes32 recordIdHash,
    address targetWallet,
    string memory newRole
  ) external onlyActiveMember {
    require(recordIdHash != bytes32(0), "Record ID hash cannot be empty");
    require(targetWallet != address(0), "Wallet address cannot be zero");
    require(_isValidRole(newRole), "Invalid role string");

    bytes32 userIdHash = _getCallerIdHash();
    bytes32 targetIdHash = wallets[targetWallet].userIdHash;
    require(targetIdHash != bytes32(0), "Target wallet not registered");

    bytes32 newRoleHash = keccak256(bytes(newRole));

    bytes32 targetRoleKey = _getRoleKey(recordIdHash, targetIdHash);
    require(recordRoles[targetRoleKey].isActive, "Target does not have an active role");

    string memory oldRole = recordRoles[targetRoleKey].role;
    bytes32 oldRoleHash = keccak256(bytes(oldRole));

    require(oldRoleHash != newRoleHash, "Target already has this role");
    require(
      oldRoleHash != keccak256(bytes("owner")),
      "Owners cannot be demoted. Owner must voluntarily remove themselves."
    );

    bool ownerExists = ownersByRecord[recordIdHash].length > 0;
    bool userIsOwner = _hasRole(recordIdHash, userIdHash, "owner");
    bool userIsAdmin = _hasRole(recordIdHash, userIdHash, "administrator");
    bool userIsSharer = _hasRole(recordIdHash, userIdHash, "sharer");
    bool userIsTarget = userIdHash == targetIdHash;

    if (newRoleHash == keccak256(bytes("owner"))) {
      if (ownerExists) {
        require(userIsOwner, "Only owners can promote to owner");
      } else {
        require(userIsAdmin, "Only administrators can promote first owner");
      }
    } else if (newRoleHash == keccak256(bytes("administrator"))) {
      require(
        userIsOwner || userIsAdmin,
        "Only owners and administrators can promote to administrator"
      );
    } else if (newRoleHash == keccak256(bytes("sharer"))) {
      if (ownerExists) {
        require(
          userIsOwner || userIsAdmin || (userIsSharer && userIsTarget),
          "Only owners and administrators can change others to sharer. Sharers can only demote themselves."
        );
      } else {
        require(
          userIsAdmin || (userIsSharer && userIsTarget),
          "Only administrators can change to sharer"
        );
      }
    } else if (newRoleHash == keccak256(bytes("viewer"))) {
      if (ownerExists) {
        require(
          userIsOwner || (userIsAdmin && userIsTarget) || (userIsSharer && userIsTarget),
          "Only owners can demote others. Administrators and sharers can only demote themselves."
        );
      } else {
        require(userIsAdmin, "Only administrators can demote to viewer");
      }
      // Subject minimum: active subjects cannot be demoted below sharer
      require(
        !_isActiveSubject(recordIdHash, targetIdHash),
        "Cannot demote an active subject below sharer"
      );
    }

    if (
      oldRoleHash == keccak256(bytes("administrator")) && newRoleHash == keccak256(bytes("viewer"))
    ) {
      if (!ownerExists) {
        require(
          adminsByRecord[recordIdHash].length > 1,
          "Cannot demote the last administrator when no owner exists"
        );
      }
    }

    _applyChangeRole(recordIdHash, userIdHash, targetIdHash, newRole, oldRole);
  }

  /**
   * @notice Allows an owner to voluntarily give up their ownership, optionally taking on a
   * lesser role instead of losing all access entirely. Must be atomic: an owner has no other
   * way to acquire a new role for themselves once they've lost the owner role (grantRole
   * requires an active role to call, and changeRole refuses to touch an owner at all), so the
   * demotion has to happen in this same transaction, not as a separate follow-up call.
   * @param recordIdHash The record ID Hash
   * @param newRole Lesser role to take instead of leaving entirely ("administrator", "sharer",
   * or "viewer"). Pass an empty string to leave with no replacement role.
   */
  function voluntarilyLeaveOwnership(
    bytes32 recordIdHash,
    string memory newRole
  ) external onlyActiveMember {
    require(recordIdHash != bytes32(0), "Record ID hash cannot be empty");

    bytes32 userIdHash = _getCallerIdHash();
    require(_hasRole(recordIdHash, userIdHash, "owner"), "You are not an owner of this record");

    bool hasOtherOwners = ownersByRecord[recordIdHash].length > 1;
    bool hasAdmins = adminsByRecord[recordIdHash].length > 0;

    require(hasOtherOwners || hasAdmins, "Cannot leave as last owner with no administrators");

    if (bytes(newRole).length > 0) {
      require(_isValidRole(newRole), "Invalid role string");
      require(
        keccak256(bytes(newRole)) != keccak256(bytes("owner")),
        "Use an empty string to leave entirely, not 'owner'"
      );
      // Subject minimum: active subjects cannot be demoted below sharer (mirrors changeRole)
      if (keccak256(bytes(newRole)) == keccak256(bytes("viewer"))) {
        require(
          !_isActiveSubject(recordIdHash, userIdHash),
          "Cannot demote an active subject below sharer"
        );
      }
      _applyChangeRole(recordIdHash, userIdHash, userIdHash, newRole, "owner");
    } else {
      bytes32 roleKey = _getRoleKey(recordIdHash, userIdHash);
      _removeFromRoleArray(recordIdHash, userIdHash, "owner");

      recordRoles[roleKey].isActive = false;
      delete roleGrantedBy[roleKey];

      emit OwnershipVoluntarilyLeft(recordIdHash, userIdHash, block.timestamp);
    }
  }

  /**
   * @notice Revoke a user's role entirely
   * @param recordIdHash The record ID Hash
   * @param targetWallet A wallet address belonging to the target user
   */
  function revokeRole(bytes32 recordIdHash, address targetWallet) external onlyActiveMember {
    require(recordIdHash != bytes32(0), "Record ID hash cannot be empty");
    require(targetWallet != address(0), "Wallet address cannot be zero");

    bytes32 userIdHash = _getCallerIdHash();
    bytes32 targetIdHash = wallets[targetWallet].userIdHash;
    require(targetIdHash != bytes32(0), "Target wallet not registered");

    bytes32 targetRoleKey = _getRoleKey(recordIdHash, targetIdHash);
    require(recordRoles[targetRoleKey].isActive, "Target does not have an active role");

    string memory role = recordRoles[targetRoleKey].role;
    bytes32 roleHash = keccak256(bytes(role));

    require(
      roleHash != keccak256(bytes("owner")),
      "Owners cannot be revoked. Owner must use voluntarilyLeaveOwnership()."
    );

    bool isSelfRevoke = userIdHash == targetIdHash;

    // Subject minimum: active subjects cannot have their role fully revoked
    require(
      !_isActiveSubject(recordIdHash, targetIdHash),
      "Cannot revoke an active subject's role. Active subjects must hold at least sharer role."
    );

    if (!isSelfRevoke) {
      bool userIsOwner = _hasRole(recordIdHash, userIdHash, "owner");
      bool userIsAdmin = _hasRole(recordIdHash, userIdHash, "administrator");
      bytes32 grantedBy = roleGrantedBy[targetRoleKey];
      bool userGrantedThisRole = (grantedBy == userIdHash);

      if (roleHash == keccak256(bytes("viewer")) || roleHash == keccak256(bytes("sharer"))) {
        require(
          userIsOwner || userIsAdmin || userGrantedThisRole,
          "Only owners, administrators, or the granter can revoke viewer/sharer roles"
        );
      } else {
        require(userIsOwner || userIsAdmin, "Only owners and administrators can revoke roles");

        if (!userIsOwner) {
          bool targetIsAdmin = roleHash == keccak256(bytes("administrator"));

          if (targetIsAdmin) {
            bool ownerExists = ownersByRecord[recordIdHash].length > 0;
            require(!ownerExists, "Only owners can revoke administrators");
          }
        }
      }
    }

    if (roleHash == keccak256(bytes("administrator"))) {
      bool hasOtherAdmins = adminsByRecord[recordIdHash].length > 1;
      bool ownerExists = ownersByRecord[recordIdHash].length > 0;

      require(
        hasOtherAdmins || ownerExists,
        "Cannot revoke last administrator without an owner present"
      );
    }

    _removeFromRoleArray(recordIdHash, targetIdHash, role);
    recordRoles[targetRoleKey].isActive = false;
    delete roleGrantedBy[targetRoleKey];

    emit RoleRevoked(recordIdHash, targetIdHash, role, userIdHash, block.timestamp);
  }

  // =================== ROLE MANAGEMENT - VIEW FUNCTIONS ===================

  /**
   * @notice Check if wallet's identity has any active role on a record
   */
  function hasActiveRole(
    bytes32 recordIdHash,
    address wallet
  ) external view override returns (bool) {
    bytes32 userIdHash = wallets[wallet].userIdHash;
    if (userIdHash == bytes32(0)) return false;
    return _hasActiveRole(recordIdHash, userIdHash);
  }

  /**
   * @notice Check if wallet's identity has a specific role
   */
  function hasRole(
    bytes32 recordIdHash,
    address wallet,
    string memory role
  ) external view override returns (bool) {
    bytes32 userIdHash = wallets[wallet].userIdHash;
    if (userIdHash == bytes32(0)) return false;
    return _hasRole(recordIdHash, userIdHash, role);
  }

  /**
   * @notice Check if wallet's identity is owner or administrator
   */
  function isOwnerOrAdmin(
    bytes32 recordIdHash,
    address wallet
  ) external view override returns (bool) {
    bytes32 userIdHash = wallets[wallet].userIdHash;
    if (userIdHash == bytes32(0)) return false;
    return _isOwnerOrAdmin(recordIdHash, userIdHash);
  }

  /**
   * @notice Get full role details by wallet
   */
  function getRoleDetails(
    bytes32 recordIdHash,
    address wallet
  ) external view returns (string memory role, bool isActive) {
    bytes32 userIdHash = wallets[wallet].userIdHash;
    if (userIdHash == bytes32(0)) {
      return ("", false);
    }
    bytes32 roleKey = _getRoleKey(recordIdHash, userIdHash);
    RecordRole memory r = recordRoles[roleKey];
    return (r.role, r.isActive);
  }

  /**
   * @notice Get full role details by identity
   */
  function getRoleDetailsByUser(
    bytes32 recordIdHash,
    bytes32 userIdHash
  ) external view returns (string memory role, bool isActive) {
    bytes32 roleKey = _getRoleKey(recordIdHash, userIdHash);
    RecordRole memory r = recordRoles[roleKey];
    return (r.role, r.isActive);
  }

  /**
   * @notice Get all role arrays for a record in one call. Superseded the individual
   *   getRecordOwners/Admins/Sharers/Viewers getters, which were removed as dead weight once
   *   every caller had this single call available instead.
   */
  function getAllRecordParticipants(
    bytes32 recordIdHash
  )
    external
    view
    returns (
      bytes32[] memory owners,
      bytes32[] memory admins,
      bytes32[] memory sharers,
      bytes32[] memory viewers
    )
  {
    return (
      ownersByRecord[recordIdHash],
      adminsByRecord[recordIdHash],
      sharersByRecord[recordIdHash],
      viewersByRecord[recordIdHash]
    );
  }

  /**
   * @notice Get role statistics for a record
   */
  function getRecordRoleStats(
    bytes32 recordIdHash
  )
    external
    view
    returns (uint256 ownerCount, uint256 adminCount, uint256 sharerCount, uint256 viewerCount)
  {
    return (
      ownersByRecord[recordIdHash].length,
      adminsByRecord[recordIdHash].length,
      sharersByRecord[recordIdHash].length,
      viewersByRecord[recordIdHash].length
    );
  }

  /**
   * @notice Check if a user is an active subject of a record
   * @dev This is a convenience function that calls HealthRecordCore
   */
  function isActiveSubject(bytes32 recordIdHash, bytes32 userIdHash) external view returns (bool) {
    return _isActiveSubject(recordIdHash, userIdHash);
  }

  /**
   * @notice Get the HealthRecordCore address
   */
  function getHealthRecordCore() external view returns (address) {
    return address(healthRecordCore);
  }

  /**
   * @notice Get who granted a specific role
   */
  function getRoleGranter(
    bytes32 recordIdHash,
    bytes32 userIdHash
  ) external view returns (bytes32) {
    bytes32 roleKey = _getRoleKey(recordIdHash, userIdHash);
    return roleGrantedBy[roleKey];
  }

  // ===============================================================
  // TRUSTEE RELATIONSHIPS
  // ===============================================================

  // =================== TRUSTEE - ENUMS ===================

  enum TrusteeLevel {
    Observer, // 0 - Read only, always gets viewer role
    Custodian, // 1 - Mirrors trustor role, capped at administrator
    Controller // 2 - Mirrors trustor role fully, including owner
  }

  enum TrusteeStatus {
    None, // 0 - Default/non-existent
    Pending, // 1 - Trustor proposed, awaiting trustee acceptance
    Active, // 2 - Trustee accepted, relationship is live
    Revoked, // 3 - Either party ended an active relationship
    Declined // 4 - Trustee declined the pending proposal
  }

  // =================== TRUSTEE - STORAGE ===================

  struct TrusteeRelationship {
    TrusteeStatus status;
    TrusteeLevel level;
  }

  // trustorIdHash => trusteeIdHash => TrusteeRelationship
  mapping(bytes32 => mapping(bytes32 => TrusteeRelationship)) public trusteeRelationships;

  // trustorIdHash => list of every trusteeIdHash ever proposed by this trustor (regardless of
  // current status). Lets us enumerate "who are this trustor's trustees" on-chain, e.g. to
  // extend trustee access automatically when the trustor anchors a new record.
  mapping(bytes32 => bytes32[]) public trusteesByTrustor;

  // trustorIdHash => trusteeIdHash => recordIdHash[] (records granted via proposeTrustee)
  mapping(bytes32 => mapping(bytes32 => bytes32[])) private _trusteeGrantedRecords;

  // Dedup set for _trusteeGrantedRecords — O(1) contains check
  // trustorIdHash => trusteeIdHash => recordIdHash => bool
  mapping(bytes32 => mapping(bytes32 => mapping(bytes32 => bool))) private _trusteeGrantedRecordSet;

  //==================== TRUSTEE - EVENTS ====================
  event TrusteeProposed(
    bytes32 indexed trustorIdHash,
    bytes32 indexed trusteeIdHash,
    TrusteeLevel level,
    uint256 timestamp
  );
  event TrusteeAccepted(
    bytes32 indexed trustorIdHash,
    bytes32 indexed trusteeIdHash,
    TrusteeLevel level,
    uint256 timestamp
  );
  event TrusteeRevoked(
    bytes32 indexed trustorIdHash,
    bytes32 indexed trusteeIdHash,
    bytes32 indexed revokedBy,
    uint256 timestamp
  );
  event TrusteeLevelUpdated(
    bytes32 indexed trustorIdHash,
    bytes32 indexed trusteeIdHash,
    TrusteeLevel oldLevel,
    TrusteeLevel newLevel,
    uint256 timestamp
  );
  event TrusteeDeclined(
    bytes32 indexed trustorIdHash,
    bytes32 indexed trusteeIdHash,
    uint256 timestamp
  );

  // =================== TRUSTEE - FUNCTIONS ===================

  /**
   * @notice Trustor proposes a trustee relationship and grants roles on their records (Step 1)
   * @param trusteeIdHash The identity hash of the proposed trustee
   * @param level The trust level (0=Observer, 1=Custodian, 2=Controller)
   * @param recordIdHashes Records to grant the trustee access to immediately.
   *   Skips any record where the trustor has no active role — should not happen
   *   in practice since callers only pass records where they are a subject.
   */
  function proposeTrustee(
    bytes32 trusteeIdHash,
    TrusteeLevel level,
    bytes32[] memory recordIdHashes
  ) external onlyActiveMember {
    bytes32 trustorIdHash = _getCallerIdHash();
    require(trusteeIdHash != bytes32(0), "Invalid trustee");
    require(trustorIdHash != trusteeIdHash, "Cannot appoint yourself");
    require(userStatus[trusteeIdHash] != MemberStatus.NotRegistered, "Trustee not registered");

    TrusteeStatus currentStatus = trusteeRelationships[trustorIdHash][trusteeIdHash].status;
    require(
      currentStatus == TrusteeStatus.None ||
        currentStatus == TrusteeStatus.Revoked ||
        currentStatus == TrusteeStatus.Declined,
      "Proposal already exists or is pending"
    );

    // Only enumerate a trustee the first time this trustor ever proposes to them — re-proposals
    // after Revoked/Declined reuse the existing entry rather than duplicating it.
    if (currentStatus == TrusteeStatus.None) {
      trusteesByTrustor[trustorIdHash].push(trusteeIdHash);
    }

    trusteeRelationships[trustorIdHash][trusteeIdHash] = TrusteeRelationship({
      status: TrusteeStatus.Pending,
      level: level
    });

    emit TrusteeProposed(trustorIdHash, trusteeIdHash, level, block.timestamp);

    for (uint256 i = 0; i < recordIdHashes.length; i++) {
      _grantTrusteeAccessToRecord(recordIdHashes[i], trustorIdHash, trusteeIdHash, level);
    }
  }

  /**
   * @notice Trustee declines a pending proposal (Step 2 — rejection path)
   * @dev Revokes all roles granted at proposal time and marks the relationship Declined.
   *   Re-proposing is allowed after Declined (same as after Revoked).
   * @param trustorIdHash The identity hash of the trustor who proposed
   */
  function declineTrustee(bytes32 trustorIdHash) external onlyActiveMember {
    bytes32 trusteeIdHash = _getCallerIdHash();
    TrusteeRelationship storage r = trusteeRelationships[trustorIdHash][trusteeIdHash];
    require(r.status == TrusteeStatus.Pending, "No pending proposal to decline");

    r.status = TrusteeStatus.Declined;

    emit TrusteeDeclined(trustorIdHash, trusteeIdHash, block.timestamp);

    bytes32[] storage grantedRecords = _trusteeGrantedRecords[trustorIdHash][trusteeIdHash];
    for (uint256 i = 0; i < grantedRecords.length; i++) {
      bytes32 recordIdHash = grantedRecords[i];
      _revokeTrusteeGrantedRecordRole(recordIdHash, trustorIdHash, trusteeIdHash, trusteeIdHash);
      delete _trusteeGrantedRecordSet[trustorIdHash][trusteeIdHash][recordIdHash];
      delete _trusteeGrantedRecordPreviousRole[trustorIdHash][trusteeIdHash][recordIdHash];
    }
    delete _trusteeGrantedRecords[trustorIdHash][trusteeIdHash];
  }

  /**
   * @notice Trustee accepts a pending proposal (Step 2)
   * @param trustorIdHash The identity hash of the trustor who proposed
   */
  function acceptTrustee(bytes32 trustorIdHash) external onlyActiveMember {
    bytes32 trusteeIdHash = _getCallerIdHash();
    TrusteeRelationship storage r = trusteeRelationships[trustorIdHash][trusteeIdHash];

    require(r.status == TrusteeStatus.Pending, "No pending proposal");

    r.status = TrusteeStatus.Active;

    emit TrusteeAccepted(trustorIdHash, trusteeIdHash, r.level, block.timestamp);
  }

  /**
   * @notice Revoke a trustee relationship — callable by either party
   * @param trustorIdHash The trustor's identity hash
   * @param trusteeIdHash The trustee's identity hash
   */
  function revokeTrustee(bytes32 trustorIdHash, bytes32 trusteeIdHash) external onlyActiveMember {
    bytes32 callerIdHash = _getCallerIdHash();
    require(
      callerIdHash == trustorIdHash || callerIdHash == trusteeIdHash,
      "Not a party to this relationship"
    );

    TrusteeStatus currentStatus = trusteeRelationships[trustorIdHash][trusteeIdHash].status;
    require(
      currentStatus == TrusteeStatus.Active || currentStatus == TrusteeStatus.Pending,
      "No active or pending relationship"
    );

    trusteeRelationships[trustorIdHash][trusteeIdHash].status = TrusteeStatus.Revoked;

    emit TrusteeRevoked(trustorIdHash, trusteeIdHash, callerIdHash, block.timestamp);

    // Revoke or downgrade every role the trustee acquired through this relationship, including
    // owner. Normal changeRole/revokeRole block owner demotion/removal, but trustee-derived
    // roles are conditional on the relationship — if it ends, so does the elevation, regardless
    // of level (a record where they had independent access first is downgraded back to it, not
    // stripped — see _revokeTrusteeGrantedRecordRole).
    bytes32[] storage grantedRecords = _trusteeGrantedRecords[trustorIdHash][trusteeIdHash];
    for (uint256 i = 0; i < grantedRecords.length; i++) {
      bytes32 recordIdHash = grantedRecords[i];
      _revokeTrusteeGrantedRecordRole(recordIdHash, trustorIdHash, trusteeIdHash, callerIdHash);
      delete _trusteeGrantedRecordSet[trustorIdHash][trusteeIdHash][recordIdHash];
      delete _trusteeGrantedRecordPreviousRole[trustorIdHash][trusteeIdHash][recordIdHash];
    }
    delete _trusteeGrantedRecords[trustorIdHash][trusteeIdHash];
  }

  /**
   * @notice Admin-only bootstrap for dependent account trustee relationships.
   *
   * WHY THIS FUNCTION EXISTS:
   * The normal trustee flow is propose (trustor) → accept (trustee), requiring two separate
   * wallet signatures. This works when both parties are independent users who can sign
   * transactions. Dependent accounts are different: at creation time there is no independent
   * person behind the dependent's wallet — the guardian has created this account. The guardian
   * cannot sign two separate on-chain transactions as two different identities without a
   * complex key-handoff ceremony.
   *
   * The CF already uses the admin wallet for addMemberBatch (member registration), so
   * extending the same admin-privileged bootstrap to include the trustee relationship does
   * not expand the trust surface. Revocation flows through the normal onlyActiveMember
   * revokeTrustee path — no admin involvement after creation.
   *
   * This must be an admin function because if it was a trustee driven function the trustee (guardian)
   * would be able to add themselves as the trustee of any account. That could be gated by creating a
   * MemberStatus of Dependent, but there would be no way to determine that the dependent was actually
   * created by the guardian without adding multiple other functions and storage to the contract. Admin function
   * is just easier at this time.
   *
   * @param trustorIdHash  keccak256 of the dependent's Firebase UID
   * @param trusteeIdHash  keccak256 of the guardian's Firebase UID
   */
  function bootstrapDependentTrustee(
    bytes32 trustorIdHash,
    bytes32 trusteeIdHash
  ) external onlyAdmin {
    require(trustorIdHash != bytes32(0), "Invalid trustor");
    require(trusteeIdHash != bytes32(0), "Invalid trustee");
    require(trustorIdHash != trusteeIdHash, "Cannot appoint yourself");
    require(userStatus[trustorIdHash] != MemberStatus.NotRegistered, "Trustor not registered");
    require(userStatus[trusteeIdHash] != MemberStatus.NotRegistered, "Trustee not registered");

    TrusteeStatus currentStatus = trusteeRelationships[trustorIdHash][trusteeIdHash].status;
    require(
      currentStatus == TrusteeStatus.None || currentStatus == TrusteeStatus.Revoked,
      "Relationship already active or pending"
    );

    if (currentStatus == TrusteeStatus.None) {
      trusteesByTrustor[trustorIdHash].push(trusteeIdHash);
    }

    trusteeRelationships[trustorIdHash][trusteeIdHash] = TrusteeRelationship({
      status: TrusteeStatus.Active,
      level: TrusteeLevel.Controller
    });

    // Emit both events to preserve the full provenance trail that indexers and the
    // sync queue expect. Identical timestamps signal an atomic bootstrap — not a
    // two-step user interaction.
    emit TrusteeProposed(trustorIdHash, trusteeIdHash, TrusteeLevel.Controller, block.timestamp);
    emit TrusteeAccepted(trustorIdHash, trusteeIdHash, TrusteeLevel.Controller, block.timestamp);
  }

  /**
   * @notice Trustor updates the trust level of an active relationship
   * @dev Only callable by the trustor — no re-acceptance required
   * @param trusteeIdHash The identity hash of the trustee
   * @param newLevel The new trust level
   */
  function updateTrusteeLevel(
    bytes32 trusteeIdHash,
    TrusteeLevel newLevel
  ) external onlyActiveMember {
    bytes32 trustorIdHash = _getCallerIdHash();
    TrusteeRelationship storage r = trusteeRelationships[trustorIdHash][trusteeIdHash];

    require(r.status == TrusteeStatus.Active, "No active trustee relationship");
    require(r.level != newLevel, "Already this trust level");

    TrusteeLevel oldLevel = r.level;
    r.level = newLevel;

    emit TrusteeLevelUpdated(trustorIdHash, trusteeIdHash, oldLevel, newLevel, block.timestamp);

    _syncTrusteeRoles(trustorIdHash, trusteeIdHash, newLevel);
  }

  /**
   * @notice Trustee self-downgrades their own trust level
   * @dev Only the trustee can call this, and only to a strictly lower level.
   *      Trustees cannot self-upgrade — that requires trustor approval via updateTrusteeLevel.
   * @param trustorIdHash The identity hash of the trustor
   * @param newLevel The new (lower) trust level
   */
  function downgradeTrusteeLevel(
    bytes32 trustorIdHash,
    TrusteeLevel newLevel
  ) external onlyActiveMember {
    bytes32 trusteeIdHash = _getCallerIdHash();
    TrusteeRelationship storage r = trusteeRelationships[trustorIdHash][trusteeIdHash];

    require(r.status == TrusteeStatus.Active, "No active trustee relationship");
    require(uint8(newLevel) < uint8(r.level), "Can only downgrade to a lower level");

    TrusteeLevel oldLevel = r.level;
    r.level = newLevel;

    emit TrusteeLevelUpdated(trustorIdHash, trusteeIdHash, oldLevel, newLevel, block.timestamp);

    _syncTrusteeRoles(trustorIdHash, trusteeIdHash, newLevel);
  }

  /**
   * @notice Called by HealthRecordCore right after a subject (re)anchors themselves to a record.
   * @dev Extends the subject's active trustees' mirrored access to the record, so trustees follow
   *   the trustor onto every record they anchor rather than only the ones enumerated at
   *   proposeTrustee time. Called from both anchorRecord and reanchorRecord — usually a no-op on
   *   reanchor (the trustee's grant is typically still active), but cheap insurance for the case
   *   where a new trustee relationship formed while the subject was unanchored.
   * @param subjectIdHash The identity who just became an active subject of recordIdHash
   * @param recordIdHash The record they (re)anchored to
   */
  function extendTrusteeGrantsOnAnchor(bytes32 subjectIdHash, bytes32 recordIdHash) external {
    require(msg.sender == address(healthRecordCore), "Only HealthRecordCore");

    bytes32[] storage trustees = trusteesByTrustor[subjectIdHash];
    for (uint256 i = 0; i < trustees.length; i++) {
      bytes32 trusteeIdHash = trustees[i];
      TrusteeRelationship memory r = trusteeRelationships[subjectIdHash][trusteeIdHash];
      if (r.status != TrusteeStatus.Active) continue;

      _grantTrusteeAccessToRecord(recordIdHash, subjectIdHash, trusteeIdHash, r.level);
    }
  }

  /**
   * @notice Called by HealthRecordCore right after a subject unanchors from a record.
   * @dev Mirror of extendTrusteeGrantsOnAnchor for the revoke side. Only touches roles that were
   *   actually granted via the trustee relationship (tracked in _trusteeGrantedRecords) — a
   *   trustee with independent access to this record for other reasons (e.g. also a direct
   *   sharer) keeps it untouched.
   * @param subjectIdHash The identity who just unanchored from recordIdHash
   * @param recordIdHash The record they unanchored from
   */
  function retractTrusteeGrantsOnUnanchor(bytes32 subjectIdHash, bytes32 recordIdHash) external {
    require(msg.sender == address(healthRecordCore), "Only HealthRecordCore");

    bytes32[] storage trustees = trusteesByTrustor[subjectIdHash];
    for (uint256 i = 0; i < trustees.length; i++) {
      bytes32 trusteeIdHash = trustees[i];
      TrusteeRelationship memory r = trusteeRelationships[subjectIdHash][trusteeIdHash];
      if (r.status != TrusteeStatus.Active) continue;

      _revokeTrusteeAccessFromRecord(recordIdHash, subjectIdHash, trusteeIdHash);
    }
  }

  // =================== TRUSTEE - ROLE GRANT HELPERS ===================

  /**
   * @dev Resolves what role a trustee should get on a record based on their level
   *   Observer  → always viewer
   *   Custodian → mirrors trustor, capped at administrator
   *   Controller → mirrors trustor exactly (including owner)
   */
  function _resolveTrusteeRole(
    bytes32 recordIdHash,
    bytes32 trustorIdHash,
    TrusteeLevel level
  ) internal view returns (string memory) {
    if (level == TrusteeLevel.Observer) {
      return "viewer";
    }

    string memory trustorRole = _getUserRole(recordIdHash, trustorIdHash);
    bytes32 trustorRoleHash = keccak256(bytes(trustorRole));

    // Sharers and viewers can only delegate viewer access — they cannot propagate
    // sharer rights they don't have the authority to grant directly.
    if (
      trustorRoleHash == keccak256(bytes("sharer")) || trustorRoleHash == keccak256(bytes("viewer"))
    ) {
      return "viewer";
    }

    if (level == TrusteeLevel.Custodian) {
      if (trustorRoleHash == keccak256(bytes("owner"))) {
        return "administrator";
      }
      return trustorRole; // administrator → administrator
    }

    // Controller — full mirror (only reaches here for owner/administrator)
    return trustorRole;
  }

  /**
   * @dev Rank used to decide whether a trustee-resolved role would actually be an upgrade over
   *   the trustee's current role. Empty/invalid role strings rank below every real role.
   */
  function _roleRank(string memory role) internal pure returns (uint8) {
    bytes32 h = keccak256(bytes(role));
    if (h == keccak256(bytes("viewer"))) return 1;
    if (h == keccak256(bytes("sharer"))) return 2;
    if (h == keccak256(bytes("administrator"))) return 3;
    if (h == keccak256(bytes("owner"))) return 4;
    return 0;
  }

  /**
   * @dev Grants a trustee mirrored access to a single record, if eligible. Shared by proposeTrustee
   *   (explicit record list) and extendTrusteeGrantsOnAnchor (triggered by a new anchor). Silently
   *   no-ops on ineligible records — same "skip, don't revert" philosophy as the batch functions.
   *
   *   If the trustee already has independent access at a LOWER rank than the resolved role, this
   *   upgrades them and records their pre-upgrade role in _trusteeGrantedRecordPreviousRole so a
   *   later revoke can restore it instead of stripping them to nothing. Equal-or-higher existing
   *   access is left untouched, matching the old behavior for that case exactly.
   */
  function _grantTrusteeAccessToRecord(
    bytes32 recordIdHash,
    bytes32 trustorIdHash,
    bytes32 trusteeIdHash,
    TrusteeLevel level
  ) internal {
    string memory role = _resolveTrusteeRole(recordIdHash, trustorIdHash, level);

    if (!_isValidRole(role)) return;
    if (!_hasActiveRole(recordIdHash, trustorIdHash)) return;

    string memory currentRole = "";
    if (_hasActiveRole(recordIdHash, trusteeIdHash)) {
      currentRole = recordRoles[_getRoleKey(recordIdHash, trusteeIdHash)].role;
      if (_roleRank(currentRole) >= _roleRank(role)) return;
    }

    _grantRoleInternal(recordIdHash, trusteeIdHash, role, trustorIdHash);

    if (!_trusteeGrantedRecordSet[trustorIdHash][trusteeIdHash][recordIdHash]) {
      _trusteeGrantedRecords[trustorIdHash][trusteeIdHash].push(recordIdHash);
      _trusteeGrantedRecordSet[trustorIdHash][trusteeIdHash][recordIdHash] = true;
      // Baseline is only ever set the FIRST time this relationship touches this record — a
      // later trust-level resync (_syncTrusteeRoles) must never overwrite it.
      _trusteeGrantedRecordPreviousRole[trustorIdHash][trusteeIdHash][recordIdHash] = currentRole;
    }
  }

  /**
   * @dev Strips or downgrades a single trustee-granted record's role, based on the stored
   *   previousRole baseline — empty means the relationship is the sole reason the trustee has
   *   any role here (strip completely); a real role means they already had independent access
   *   at that lower role (restore it instead of stripping). Deliberately does NOT touch
   *   _trusteeGrantedRecords/_trusteeGrantedRecordSet/_trusteeGrantedRecordPreviousRole —
   *   callers own that bookkeeping, since each has a different cleanup shape (bulk-delete after
   *   a loop vs. one-at-a-time removal). Must be called BEFORE the caller clears
   *   _trusteeGrantedRecordPreviousRole, since it reads that mapping.
   */
  function _revokeTrusteeGrantedRecordRole(
    bytes32 recordIdHash,
    bytes32 trustorIdHash,
    bytes32 trusteeIdHash,
    bytes32 revokedByIdHash
  ) internal {
    if (!_hasActiveRole(recordIdHash, trusteeIdHash)) return;

    string memory previousRole = _trusteeGrantedRecordPreviousRole[trustorIdHash][trusteeIdHash][
      recordIdHash
    ];
    bytes32 roleKey = _getRoleKey(recordIdHash, trusteeIdHash);
    string memory currentRole = recordRoles[roleKey].role;

    if (bytes(previousRole).length == 0) {
      _removeFromRoleArray(recordIdHash, trusteeIdHash, currentRole);
      recordRoles[roleKey].isActive = false;
      delete roleGrantedBy[roleKey];
      emit RoleRevoked(recordIdHash, trusteeIdHash, currentRole, revokedByIdHash, block.timestamp);
    } else {
      _applyChangeRole(recordIdHash, revokedByIdHash, trusteeIdHash, previousRole, currentRole);
    }
  }

  /**
   * @dev Revokes (or downgrades) a trustee's mirrored access to a single record, if it was ever
   *   granted via the trustee relationship. Mirror of _grantTrusteeAccessToRecord — only touches
   *   roles tracked in _trusteeGrantedRecords, so a trustee with independent access (e.g. also a
   *   direct sharer) keeps it untouched. Silently no-ops if there's nothing to revoke.
   */
  function _revokeTrusteeAccessFromRecord(
    bytes32 recordIdHash,
    bytes32 trustorIdHash,
    bytes32 trusteeIdHash
  ) internal {
    if (!_trusteeGrantedRecordSet[trustorIdHash][trusteeIdHash][recordIdHash]) return;

    _revokeTrusteeGrantedRecordRole(recordIdHash, trustorIdHash, trusteeIdHash, trustorIdHash);

    _trusteeGrantedRecordSet[trustorIdHash][trusteeIdHash][recordIdHash] = false;
    delete _trusteeGrantedRecordPreviousRole[trustorIdHash][trusteeIdHash][recordIdHash];
    _removeFromBytes32Array(_trusteeGrantedRecords[trustorIdHash][trusteeIdHash], recordIdHash);
  }

  function _applyChangeRole(
    bytes32 recordIdHash,
    bytes32 userIdHash,
    bytes32 targetIdHash,
    string memory newRole,
    string memory oldRole
  ) internal {
    _grantRoleInternal(recordIdHash, targetIdHash, newRole, userIdHash);
    emit RoleChanged(recordIdHash, targetIdHash, oldRole, newRole, userIdHash, block.timestamp);
  }

  /**
   * @dev Resyncs a trustee's roles across all tracked records to match their new trust level.
   *      Called by updateTrusteeLevel and downgradeTrusteeLevel. Bypasses the owner-demotion
   *      guard in changeRole because trustee-derived roles are conditional on the relationship.
   */
  function _syncTrusteeRoles(
    bytes32 trustorIdHash,
    bytes32 trusteeIdHash,
    TrusteeLevel newLevel
  ) internal {
    bytes32[] storage grantedRecords = _trusteeGrantedRecords[trustorIdHash][trusteeIdHash];
    for (uint256 i = 0; i < grantedRecords.length; i++) {
      bytes32 recordIdHash = grantedRecords[i];
      if (!_hasActiveRole(recordIdHash, trusteeIdHash)) continue;

      string memory newRole = _resolveTrusteeRole(recordIdHash, trustorIdHash, newLevel);
      if (!_isValidRole(newRole)) continue;

      bytes32 roleKey = _getRoleKey(recordIdHash, trusteeIdHash);
      string memory oldRole = recordRoles[roleKey].role;
      if (keccak256(bytes(oldRole)) == keccak256(bytes(newRole))) continue;

      _applyChangeRole(recordIdHash, trustorIdHash, trusteeIdHash, newRole, oldRole);
    }
  }

  // =================================================================================================================
  // GENERAL NOTE ON BATCH ROLE FUNCTIONS: Batch role functions are intentionally separated from single role functions
  // This is because the "require" in the single role functions give clear error messages. The batch role functions use
  // "continue" and silently skip ineligible records. This is better for UX so that one incorrect record doesn't crash a
  // 20 record grant. Using single grant functions when possible and batch when necessary balances error/logging
  // concerns with better UX.
  // =================================================================================================================

  /**
   * @dev Internal batch grant — caller is responsible for permission checks before invoking
   * @param recordIdHashes Array of record IDs
   * @param targetIdHash The identity to grant roles to
   * @param roles Array of roles — must match recordIdHashes length
   * @param granterIdHash The identity granting the roles (for audit trail)
   */
  function _grantRoleBatchInternal(
    bytes32[] memory recordIdHashes,
    bytes32 targetIdHash,
    string[] memory roles,
    bytes32 granterIdHash
  ) internal {
    for (uint256 i = 0; i < recordIdHashes.length; i++) {
      if (!_isValidRole(roles[i])) continue;
      if (!_hasActiveRole(recordIdHashes[i], granterIdHash)) continue;
      if (_hasActiveRole(recordIdHashes[i], targetIdHash)) continue;

      bytes32 roleHash = keccak256(bytes(roles[i]));
      bool granterIsOwner = _hasRole(recordIdHashes[i], granterIdHash, "owner");
      bool granterIsAdmin = _hasRole(recordIdHashes[i], granterIdHash, "administrator");

      if (roleHash == keccak256(bytes("owner"))) {
        bool ownerExists = ownersByRecord[recordIdHashes[i]].length > 0;
        if (ownerExists ? !granterIsOwner : !granterIsAdmin) continue;
      } else if (roleHash == keccak256(bytes("administrator"))) {
        if (!granterIsOwner && !granterIsAdmin) continue;
      } else if (roleHash == keccak256(bytes("sharer"))) {
        if (!granterIsOwner && !granterIsAdmin) continue;
      } else {
        // viewer — owner, admin, or sharer may grant
        bool granterIsSharer = _hasRole(recordIdHashes[i], granterIdHash, "sharer");
        if (!granterIsOwner && !granterIsAdmin && !granterIsSharer) continue;
      }

      _grantRoleInternal(recordIdHashes[i], targetIdHash, roles[i], granterIdHash);
    }
  }

  /**
   * @notice General purpose batch role grant — caller grants target a role on multiple records
   * @param recordIdHashes Array of record IDs
   * @param targetWallet The identity to grant roles to
   * @param roles Array of roles — must match recordIdHashes length
   */
  function grantRoleBatch(
    bytes32[] memory recordIdHashes,
    address targetWallet,
    string[] memory roles
  ) external onlyActiveMember {
    require(recordIdHashes.length == roles.length, "Array length mismatch");
    bytes32 userIdHash = _getCallerIdHash();
    bytes32 targetIdHash = wallets[targetWallet].userIdHash;
    require(targetIdHash != bytes32(0), "Target wallet not registered");
    _grantRoleBatchInternal(recordIdHashes, targetIdHash, roles, userIdHash);
  }

  /**
   * @notice Batch change a target's role across multiple records
   * @param recordIdHashes Array of record IDs
   * @param targetWallet The identity whose role is being changed
   * @param newRoles Array of new roles — must match recordIdHashes length
   */
  function changeRoleBatch(
    bytes32[] memory recordIdHashes,
    address targetWallet,
    string[] memory newRoles
  ) external onlyActiveMember {
    require(recordIdHashes.length == newRoles.length, "Array length mismatch");
    bytes32 userIdHash = _getCallerIdHash();
    bytes32 targetIdHash = wallets[targetWallet].userIdHash;
    require(targetIdHash != bytes32(0), "Target wallet not registered");

    for (uint256 i = 0; i < recordIdHashes.length; i++) {
      bytes32 recordIdHash = recordIdHashes[i];
      string memory newRole = newRoles[i];

      if (!_isValidRole(newRole)) continue;
      if (!_hasActiveRole(recordIdHash, userIdHash)) continue;
      if (!_hasActiveRole(recordIdHash, targetIdHash)) continue;

      bytes32 targetRoleKey = _getRoleKey(recordIdHash, targetIdHash);
      string memory oldRole = recordRoles[targetRoleKey].role;
      bytes32 oldRoleHash = keccak256(bytes(oldRole));
      bytes32 newRoleHash = keccak256(bytes(newRole));

      if (oldRoleHash == newRoleHash) continue;
      if (oldRoleHash == keccak256(bytes("owner"))) continue;

      bool ownerExists = ownersByRecord[recordIdHash].length > 0;
      bool userIsOwner = _hasRole(recordIdHash, userIdHash, "owner");
      bool userIsAdmin = _hasRole(recordIdHash, userIdHash, "administrator");
      bool userIsSharer = _hasRole(recordIdHash, userIdHash, "sharer");
      bool userIsTarget = userIdHash == targetIdHash;

      if (newRoleHash == keccak256(bytes("owner"))) {
        if (ownerExists) {
          if (!userIsOwner) continue;
        } else {
          if (!userIsAdmin) continue;
        }
      } else if (newRoleHash == keccak256(bytes("administrator"))) {
        if (!userIsOwner && !userIsAdmin) continue;
      } else if (newRoleHash == keccak256(bytes("sharer"))) {
        if (ownerExists) {
          if (!userIsOwner && !userIsAdmin && !(userIsSharer && userIsTarget)) continue;
        } else {
          if (!userIsAdmin && !(userIsSharer && userIsTarget)) continue;
        }
      } else if (newRoleHash == keccak256(bytes("viewer"))) {
        if (ownerExists) {
          if (!userIsOwner && !(userIsAdmin && userIsTarget) && !(userIsSharer && userIsTarget))
            continue;
        } else {
          if (!userIsAdmin) continue;
        }
        // Subject minimum: cannot demote an active subject below sharer
        if (_isActiveSubject(recordIdHash, targetIdHash)) continue;
      }

      if (
        oldRoleHash == keccak256(bytes("administrator")) &&
        newRoleHash == keccak256(bytes("viewer")) &&
        !ownerExists &&
        adminsByRecord[recordIdHash].length <= 1
      ) continue;

      _applyChangeRole(recordIdHash, userIdHash, targetIdHash, newRole, oldRole);
    }
  }

  /**
   * @notice Batch revoke a target's role across multiple records
   * @param recordIdHashes Array of record ID Hashes
   * @param targetWallet A wallet belonging to the target identity
   */
  function revokeRoleBatch(
    bytes32[] memory recordIdHashes,
    address targetWallet
  ) external onlyActiveMember {
    require(targetWallet != address(0), "Invalid wallet");
    bytes32 userIdHash = _getCallerIdHash();
    bytes32 targetIdHash = wallets[targetWallet].userIdHash;
    require(targetIdHash != bytes32(0), "Target wallet not registered");

    bool isSelfRevoke = userIdHash == targetIdHash;

    for (uint256 i = 0; i < recordIdHashes.length; i++) {
      if (!_hasActiveRole(recordIdHashes[i], targetIdHash)) continue;

      bytes32 targetRoleKey = _getRoleKey(recordIdHashes[i], targetIdHash);
      string memory role = recordRoles[targetRoleKey].role;
      bytes32 roleHash = keccak256(bytes(role));

      // Never revoke owners in batch — owners must use voluntarilyLeaveOwnership
      if (roleHash == keccak256(bytes("owner"))) continue;

      // Subject minimum: active subjects must hold at least sharer
      if (_isActiveSubject(recordIdHashes[i], targetIdHash)) continue;

      if (!isSelfRevoke) {
        bool userIsOwner = _hasRole(recordIdHashes[i], userIdHash, "owner");
        bool userIsAdmin = _hasRole(recordIdHashes[i], userIdHash, "administrator");

        if (roleHash == keccak256(bytes("viewer")) || roleHash == keccak256(bytes("sharer"))) {
          bool userGrantedThisRole = roleGrantedBy[targetRoleKey] == userIdHash;
          if (!userIsOwner && !userIsAdmin && !userGrantedThisRole) continue;
        } else if (roleHash == keccak256(bytes("administrator"))) {
          bool ownerExists = ownersByRecord[recordIdHashes[i]].length > 0;
          // With an owner present only owners can revoke admins; without one, admins can too
          if (ownerExists ? !userIsOwner : (!userIsOwner && !userIsAdmin)) continue;
        }
      }

      // Last-admin guard: cannot leave a record with no admin and no owner
      if (roleHash == keccak256(bytes("administrator"))) {
        bool ownerExists = ownersByRecord[recordIdHashes[i]].length > 0;
        if (!ownerExists && adminsByRecord[recordIdHashes[i]].length <= 1) continue;
      }

      _removeFromRoleArray(recordIdHashes[i], targetIdHash, role);
      recordRoles[targetRoleKey].isActive = false;
      delete roleGrantedBy[targetRoleKey];

      emit RoleRevoked(recordIdHashes[i], targetIdHash, role, userIdHash, block.timestamp);
    }
  }

  // =================== TRUSTEE - VIEW FUNCTIONS ===================

  /**
   * @notice Check if a controller relationship is active
   * @dev Kept for HealthRecordCore._resolveSubject compatibility — checks Controller level
   */
  function isControllerOf(
    bytes32 trustorIdHash,
    bytes32 trusteeIdHash
  ) external view override returns (bool) {
    TrusteeRelationship memory r = trusteeRelationships[trustorIdHash][trusteeIdHash];
    return r.status == TrusteeStatus.Active && r.level == TrusteeLevel.Controller;
  }

  /**
   * @notice Get the full trustee relationship
   */
  function getTrusteeRelationship(
    bytes32 trustorIdHash,
    bytes32 trusteeIdHash
  ) external view returns (TrusteeStatus status, TrusteeLevel level) {
    TrusteeRelationship memory r = trusteeRelationships[trustorIdHash][trusteeIdHash];
    return (r.status, r.level);
  }

  /**
   * @notice Get all records the trustee was granted access to via proposeTrustee
   * @dev Debug/inspection helper — used to verify trustee role tracking
   */
  function getTrusteeGrantedRecords(
    bytes32 trustorIdHash,
    bytes32 trusteeIdHash
  ) external view returns (bytes32[] memory) {
    return _trusteeGrantedRecords[trustorIdHash][trusteeIdHash];
  }

  /**
   * @notice Get every identity hash ever proposed as a trustee for this trustor
   * @dev Includes Revoked/Declined entries — filter by status via getTrusteeRelationship
   */
  function getTrusteesForTrustor(bytes32 trustorIdHash) external view returns (bytes32[] memory) {
    return trusteesByTrustor[trustorIdHash];
  }

  // ===============================================================
  // VOUCHES
  // ===============================================================

  // =================== VOUCHES - ENUMS ===================

  enum VouchStatus {
    None, // 0 - Default, never vouched
    Active, // 1 - Currently vouching
    Retracted // 2 - Previously vouched, now retracted
  }

  // =================== VOUCHES - EVENTS ===================

  event VouchGiven(bytes32 indexed voucherIdHash, bytes32 indexed voucheeIdHash, uint256 timestamp);

  event VouchRetracted(
    bytes32 indexed voucherIdHash,
    bytes32 indexed voucheeIdHash,
    uint256 timestamp
  );

  // =================== VOUCHES - STORAGE ===================

  // voucherIdHash => voucheeIdHash => VouchStatus (tracks full history)
  mapping(bytes32 => mapping(bytes32 => VouchStatus)) public vouches;

  // voucherIdHash => list of currently active vouchee identity hashes
  mapping(bytes32 => bytes32[]) public vouchesGiven;

  // voucheeIdHash => list of currently active voucher identity hashes
  mapping(bytes32 => bytes32[]) public vouchesReceived;

  // =================== VOUCHES - FUNCTIONS ===================

  /**
   * @notice Give a vouch to another active member
   * @dev Re-vouching after retraction is allowed (Retracted → Active)
   * @param voucheeIdHash The identity hash of the user being vouched for
   */
  function giveVouch(bytes32 voucheeIdHash) external onlyActiveMember {
    bytes32 voucherIdHash = _getCallerIdHash();
    require(voucheeIdHash != bytes32(0), "Invalid vouchee");
    require(voucherIdHash != voucheeIdHash, "Cannot vouch for yourself");

    MemberStatus voucheeStatus = userStatus[voucheeIdHash];
    require(
      voucheeStatus == MemberStatus.Active ||
        voucheeStatus == MemberStatus.Verified ||
        voucheeStatus == MemberStatus.VerifiedProvider,
      "Vouchee must be an active member"
    );

    require(
      vouches[voucherIdHash][voucheeIdHash] != VouchStatus.Active,
      "Already vouching for this user"
    );

    vouches[voucherIdHash][voucheeIdHash] = VouchStatus.Active;
    vouchesGiven[voucherIdHash].push(voucheeIdHash);
    vouchesReceived[voucheeIdHash].push(voucherIdHash);

    emit VouchGiven(voucherIdHash, voucheeIdHash, block.timestamp);
  }

  /**
   * @notice Retract a previously given vouch
   * @dev Sets status to Retracted (not None) to preserve history
   * @param voucheeIdHash The identity hash of the user being un-vouched
   */
  function retractVouch(bytes32 voucheeIdHash) external onlyActiveMember {
    bytes32 voucherIdHash = _getCallerIdHash();
    require(
      vouches[voucherIdHash][voucheeIdHash] == VouchStatus.Active,
      "No active vouch for this user"
    );

    vouches[voucherIdHash][voucheeIdHash] = VouchStatus.Retracted;
    _removeFromBytes32Array(vouchesGiven[voucherIdHash], voucheeIdHash);
    _removeFromBytes32Array(vouchesReceived[voucheeIdHash], voucherIdHash);

    emit VouchRetracted(voucherIdHash, voucheeIdHash, block.timestamp);
  }

  // =================== VOUCHES - VIEW FUNCTIONS ===================

  /**
   * @notice Check if a user is currently actively vouching for another user
   */
  function hasVouched(bytes32 voucherIdHash, bytes32 voucheeIdHash) external view returns (bool) {
    return vouches[voucherIdHash][voucheeIdHash] == VouchStatus.Active;
  }

  /**
   * @notice Get the full vouch status between two users (None, Active, or Retracted)
   */
  function getVouchStatus(
    bytes32 voucherIdHash,
    bytes32 voucheeIdHash
  ) external view returns (VouchStatus) {
    return vouches[voucherIdHash][voucheeIdHash];
  }

  /**
   * @notice Get all identity hashes a user is currently actively vouching for
   */
  function getVouchesGiven(bytes32 voucherIdHash) external view returns (bytes32[] memory) {
    return vouchesGiven[voucherIdHash];
  }

  /**
   * @notice Get all identity hashes currently actively vouching for a user
   */
  function getVouchesReceived(bytes32 voucheeIdHash) external view returns (bytes32[] memory) {
    return vouchesReceived[voucheeIdHash];
  }

  // trustorIdHash => trusteeIdHash => recordIdHash => role the trustee held immediately before
  // this relationship touched this record. "" means the relationship is the sole reason they
  // have any role here at all — strip completely on revoke. A real role means they already had
  // independent access at that lower role — restore it on revoke instead of stripping. Set once,
  // the first time _grantTrusteeAccessToRecord processes this record (guarded by
  // _trusteeGrantedRecordSet) — never overwritten by a later trust-level change, since
  // _syncTrusteeRoles doesn't touch this mapping.
  mapping(bytes32 => mapping(bytes32 => mapping(bytes32 => string))) private _trusteeGrantedRecordPreviousRole;

  // ===============================================================
  // STORAGE GAP
  // Safe upgrade buffer — future versions can consume these slots
  // without shifting the storage layout of existing variables.
  // New variables must be appended HERE (before __gap), never inserted above.
  // ===============================================================

  uint256[49] private __gap;
}
