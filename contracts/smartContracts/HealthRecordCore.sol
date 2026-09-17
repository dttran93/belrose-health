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
    bytes32 trusteeIdHash
  ) external view returns (bool);

  function extendTrusteeGrantsOnAnchor(bytes32 subjectIdHash, bytes32 recordIdHash) external;

  function retractTrusteeGrantsOnUnanchor(bytes32 subjectIdHash, bytes32 recordIdHash) external;
}

/**
 * @title HealthRecordCore
 * @dev Handles record anchoring and record reviews
 * References MemberRoleManager for membership and role checks
 */
contract HealthRecordCore is Initializable, UUPSUpgradeable {
  // ===============================================================
  // CONTRACT SETUP
  // ===============================================================

  MemberRoleManagerInterface public memberRoleManager;

  address public admin;
  event AdminTransferred(address indexed oldAdmin, address indexed newAdmin, uint256 timestamp);
  event MemberRoleManagerUpdated(address indexed newAddress, uint256 timestamp);

  //As in only the Admin wallet can do this function. Don't confuse with Admin role for users below
  modifier onlyAdmin() {
    require(msg.sender == admin, "Only admin");
    _;
  }

  modifier onlyActiveMember() {
    require(memberRoleManager.isActiveMember(msg.sender), "Not an active member");
    _;
  }

  modifier onlyVerifiedMember() {
    require(memberRoleManager.isVerifiedMember(msg.sender), "Not a verified member");
    _;
  }

  modifier onlyRecordParticipant(bytes32 recordIdHash) {
    require(memberRoleManager.hasActiveRole(recordIdHash, msg.sender), "No access to this record");
    _;
  }

  modifier onlyOwnerOrAdmin(bytes32 recordIdHash) {
    require(memberRoleManager.isOwnerOrAdmin(recordIdHash, msg.sender), "Only owner or admin");
    _;
  }

  modifier onlyOwner(bytes32 recordIdHash) {
    require(memberRoleManager.hasRole(recordIdHash, msg.sender, "owner"), "Only owner");
    _;
  }

  /// @custom:oz-upgrades-unsafe-allow constructor
  constructor() {
    _disableInitializers();
  }

  /**
   * @notice Initialize the contract (replaces constructor)
   * @dev Can only be called once during proxy development
   * @param _memberRoleManager Address of the MemberRoleManager proxy
   */
  function initialize(address _memberRoleManager) public initializer {
    require(_memberRoleManager != address(0), "Invalid MemberRoleManager address");
    memberRoleManager = MemberRoleManagerInterface(_memberRoleManager);
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
   * @notice Update the MemberRoleManager reference (in case of upgrade)
   */
  function setMemberRoleManager(address _memberRoleManager) external onlyAdmin {
    require(_memberRoleManager != address(0), "Invalid address");
    memberRoleManager = MemberRoleManagerInterface(_memberRoleManager);
    emit MemberRoleManagerUpdated(_memberRoleManager, block.timestamp);
  }

  // ===============================================================
  // INTERNAL HELPERS
  // ===============================================================

  /**
   * @dev Resolves the effective subject identity for anchoring operations.
   * Pass bytes32(0) to act as yourself — preserves existing behaviour for all current callers.
   * Pass a trustorIdHash to act as their controller — caller must be an active controller.
   */
  function _resolveSubject(bytes32 subjectIdHash) internal view returns (bytes32) {
    bytes32 callerIdHash = memberRoleManager.getUserForWallet(msg.sender);
    require(callerIdHash != bytes32(0), "Wallet not registered");

    if (subjectIdHash == bytes32(0) || subjectIdHash == callerIdHash) {
      return callerIdHash;
    }

    require(
      memberRoleManager.isControllerOf(subjectIdHash, callerIdHash),
      "Not a controller for this identity"
    );

    return subjectIdHash;
  }

  // ===============================================================
  // RECORD ANCHORING
  // ===============================================================

  // =================== RECORD ANCHORING - EVENTS ===================

  event RecordAnchored(
    bytes32 indexed recordIdHash,
    bytes32 indexed recordHash,
    bytes32 indexed subjectIdHash,
    uint256 timestamp
  );

  event RecordUnanchored(
    bytes32 indexed recordIdHash,
    bytes32 indexed subjectIdHash,
    uint256 timestamp
  );

  event RecordHashAdded(
    bytes32 indexed recordIdHash,
    bytes32 indexed newHash,
    bytes32 addedBy,
    uint256 timestamp
  );

  event RecordHashRetracted(
    bytes32 indexed recordIdHash,
    bytes32 indexed recordHash,
    uint256 timestamp
  );

  // =================== RECORD ANCHORING - STORAGE ===================

  //recordIdHash => list of subject userIdHashes (who is this record about)
  mapping(bytes32 => bytes32[]) public recordSubjects;

  // recordIdHash => subjectIdHash => bool (quick lookup: is this user a subject?)
  mapping(bytes32 => mapping(bytes32 => bool)) public isSubjectOfRecord;

  // userIdHash => list of recordIdHashes (user's complete medical history)
  mapping(bytes32 => bytes32[]) public subjectMedicalHistory;

  // recordIdHash => subjectIdHash => bool (is this subject link active?)
  mapping(bytes32 => mapping(bytes32 => bool)) public isSubjectActive;

  //recordHash => recordIdHash (each hash belongs to exactly one record)
  mapping(bytes32 => bytes32) public recordIdForHash;

  //recordIdHash => list of record hashes (versionhistory)
  mapping(bytes32 => bytes32[]) public recordVersionHistory;

  // recordIdHash => bool (is this hash actively attached to a record)
  mapping(bytes32 => bool) public isHashActive; //soft-delete toggle

  uint256 public totalAnchoredRecords;

  // =================== RECORD ANCHORING - FUNCTIONS ===================

  /**
   * @notice Subject anchors themselves to a record with a hash
   * @dev First subject establishes initial hash; subsequent subjects confirm it
   * @param recordIdHash The record ID
   * @param recordHash The content hash (must match current if not first subject)
   * @param selfVerifyLevel Nudge param — 0 skips, 1-3 (Provenance/Content/Full) also records the
   *   caller's verification of recordHash in the same transaction. Anchoring asserts "this record
   *   is about me," which in most cases also means confirming its contents, so the frontend should
   *   default this to a nonzero level and require the user to actively opt out. Silently skipped
   *   (never reverts) if the caller already verified or is disputing this hash — the nudge must
   *   never block the anchor itself.
   */
  function anchorRecord(
    bytes32 recordIdHash,
    bytes32 recordHash,
    bytes32 subjectIdHash,
    uint8 selfVerifyLevel
  ) external onlyActiveMember onlyRecordParticipant(recordIdHash) {
    require(recordIdHash != bytes32(0), "Record ID cannot be empty");
    require(recordHash != bytes32(0), "Record hash cannot be empty");

    //Resolve subject as either the subject themselves or an assigned Controller Trustee
    bytes32 resolvedSubject = _resolveSubject(subjectIdHash);

    // Check not already anchored
    require(
      !isSubjectOfRecord[recordIdHash][resolvedSubject],
      "Record already anchored to this subject"
    );

    //Check if this is the first subject
    bool isFirstSubject = recordSubjects[recordIdHash].length == 0;

    if (isFirstSubject) {
      // Check if Hash is already in use
      bytes32 existingRecordIdHash = recordIdForHash[recordHash];

      if (existingRecordIdHash != bytes32(0)) {
        require(existingRecordIdHash == recordIdHash, "Hash belongs to different record");
      } else {
        require(!isHashActive[recordHash], "Hash already used");
        recordIdForHash[recordHash] = recordIdHash;
        recordVersionHistory[recordIdHash].push(recordHash);
        isHashActive[recordHash] = true;
      }
    }

    recordSubjects[recordIdHash].push(resolvedSubject);
    isSubjectOfRecord[recordIdHash][resolvedSubject] = true;
    isSubjectActive[recordIdHash][resolvedSubject] = true;
    subjectMedicalHistory[resolvedSubject].push(recordIdHash);
    totalAnchoredRecords++;

    emit RecordAnchored(recordIdHash, recordHash, resolvedSubject, block.timestamp);

    bytes32 callerIdHash = memberRoleManager.getUserForWallet(msg.sender);
    _maybeSelfVerify(recordIdHash, recordHash, callerIdHash, selfVerifyLevel);

    memberRoleManager.extendTrusteeGrantsOnAnchor(resolvedSubject, recordIdHash);
  }

  /**
   * @notice Deactivate a subject link (soft delete)
   * @param recordIdHash The record ID
   */
  function unanchorRecord(
    bytes32 recordIdHash,
    bytes32 subjectIdHash
  ) external onlyActiveMember onlyRecordParticipant(recordIdHash) {
    bytes32 resolvedSubject = _resolveSubject(subjectIdHash);

    require(isSubjectOfRecord[recordIdHash][resolvedSubject], "Not a subject of this record");
    require(isSubjectActive[recordIdHash][resolvedSubject], "Already unanchored");

    isSubjectActive[recordIdHash][resolvedSubject] = false;
    //Don't remove from subjectMedicalHistory to preserve audit trail

    emit RecordUnanchored(recordIdHash, resolvedSubject, block.timestamp);

    memberRoleManager.retractTrusteeGrantsOnUnanchor(resolvedSubject, recordIdHash);
  }

  /**
   * @notice Reactivate a previously unanchored subject link
   * @dev Emits RecordAnchored (not a separate event) — from the end-state's perspective a
   * reanchor is indistinguishable from an anchor, so a distinct RecordReanchored event was
   * redundant and never actually consumed by anything. recordHash is the record's current hash
   * (last entry in recordVersionHistory) rather than a caller-supplied argument, since a reanchor
   * never changes which hash the subject is confirming. Also mirrors anchorRecord's self-verify
   * nudge — reanchoring is the same "this record is about me" signal as an initial anchor, so it
   * gets the same treatment, including the same opt-out (selfVerifyLevel: 0 no-ops in
   * _maybeSelfVerify, same as anchorRecord).
   * @param recordIdHash The record ID
   * @param selfVerifyLevel Nudge param — see anchorRecord's own doc comment.
   */
  function reanchorRecord(
    bytes32 recordIdHash,
    bytes32 subjectIdHash,
    uint8 selfVerifyLevel
  ) external onlyActiveMember onlyRecordParticipant(recordIdHash) {
    bytes32 resolvedSubject = _resolveSubject(subjectIdHash);

    require(isSubjectOfRecord[recordIdHash][resolvedSubject], "Was never a subject");
    require(!isSubjectActive[recordIdHash][resolvedSubject], "Already active");

    isSubjectActive[recordIdHash][resolvedSubject] = true;

    bytes32[] storage versionHistory = recordVersionHistory[recordIdHash];
    bytes32 currentHash = versionHistory[versionHistory.length - 1];
    emit RecordAnchored(recordIdHash, currentHash, resolvedSubject, block.timestamp);

    bytes32 callerIdHash = memberRoleManager.getUserForWallet(msg.sender);
    _maybeSelfVerify(recordIdHash, currentHash, callerIdHash, selfVerifyLevel);

    memberRoleManager.extendTrusteeGrantsOnAnchor(resolvedSubject, recordIdHash);
  }

  /**
   * @notice Add a new Record Hash to the blockchain. In the case where a provider creates their verification first
   * this essentially serves as the provider's "anchoring" of a record onChain. The patient is then notified to
   * add themselves as a subject to this record that has been verified.
   *
   * @dev Intentionally onlyRecordParticipant (rather than onlyOwnerOrAdmin). Viewers and sharers can verify
   * and dispute records, so they must be able to register a hash before doing so. The abuse vector
   * (a participant submitting a fake hash) is low-risk: no one can verify a hash without the actual
   * record content, the fake hash just pollutes version history, and owners/admins can retract it via
   * retractRecordHash. Further, a subject submitting a fraudulently edited hash is also low risk because
   * they are free to edit their record however they want. For it to have real credibility they would need a
   * verifier to vouch for it, which cannot be faked in this function.
   *
   *  The real gate is the role grant itself — only owner/admin/sharer can make
   * someone a participant in the first place.
   *
   * @param recordIdHash The record ID
   * @param newHash The new content hash
   */
  function addRecordHash(
    bytes32 recordIdHash,
    bytes32 newHash
  ) external onlyActiveMember onlyRecordParticipant(recordIdHash) {
    require(recordIdForHash[newHash] == bytes32(0), "Hash already bound to a record");
    require(newHash != bytes32(0), "Hash cannot be empty");

    bytes32 userIdHash = memberRoleManager.getUserForWallet(msg.sender);

    recordIdForHash[newHash] = recordIdHash;
    recordVersionHistory[recordIdHash].push(newHash);
    isHashActive[newHash] = true;

    emit RecordHashAdded(recordIdHash, newHash, userIdHash, block.timestamp);
  }

  /**
   * @notice Retract a specific version of a record (e.g., if uploaded in error)
   * @dev Prevents retraction if it is the only active hash remaining
   */
  function retractRecordHash(
    bytes32 recordIdHash,
    bytes32 recordHash
  ) external onlyActiveMember onlyOwnerOrAdmin(recordIdHash) {
    // Ensure this hash actually belongs to this recordIdHash
    require(recordIdForHash[recordHash] == recordIdHash, "Hash-Record mismatch");
    require(isHashActive[recordHash], "Already retracted");

    // Ensure there is at least one hash remaining to be associated with the recordIdHash
    uint256 activeCount = 0;
    bytes32[] memory history = recordVersionHistory[recordIdHash];

    for (uint256 i = 0; i < history.length; i++) {
      if (isHashActive[history[i]]) {
        activeCount++;
      }
    }

    require(activeCount > 1, "Cannot retract the last active version of a record");

    isHashActive[recordHash] = false;
    delete recordIdForHash[recordHash];
    //Don't remove from recordVersionHistory to preserve audit trail

    emit RecordHashRetracted(recordIdHash, recordHash, block.timestamp);
  }

  // =================== RECORD ANCHORING - VIEW FUNCTIONS ===================

  /**
   * @notice Get the subject (patient) of a record
   */
  function getRecordSubjects(bytes32 recordIdHash) external view returns (bytes32[] memory) {
    return recordSubjects[recordIdHash];
  }

  /**
   * @notice Get all recordIdHashes where a user is the subject (includes records that may be unanchored)
   */
  function getSubjectMedicalHistory(bytes32 userIdHash) external view returns (bytes32[] memory) {
    return subjectMedicalHistory[userIdHash];
  }

  /**
   * @notice Check if an address is the subject of a record
   */
  function isSubject(bytes32 recordIdHash, bytes32 userIdHash) external view returns (bool) {
    return isSubjectOfRecord[recordIdHash][userIdHash];
  }

  /**
   * @notice Check if user is an ACTIVE subject of a record
   */
  function isActiveSubject(bytes32 recordIdHash, bytes32 userIdHash) external view returns (bool) {
    return isSubjectOfRecord[recordIdHash][userIdHash] && isSubjectActive[recordIdHash][userIdHash];
  }

  /**
   * @notice Get only active subjects for a record
   */
  function getActiveRecordSubjects(bytes32 recordIdHash) external view returns (bytes32[] memory) {
    bytes32[] memory allSubjects = recordSubjects[recordIdHash];

    // Count active first
    uint256 activeCount = 0;
    for (uint256 i = 0; i < allSubjects.length; i++) {
      if (isSubjectActive[recordIdHash][allSubjects[i]]) {
        activeCount++;
      }
    }

    // Build result
    bytes32[] memory result = new bytes32[](activeCount);
    uint256 idx = 0;
    for (uint256 i = 0; i < allSubjects.length; i++) {
      if (isSubjectActive[recordIdHash][allSubjects[i]]) {
        result[idx++] = allSubjects[i];
      }
    }

    return result;
  }

  /**
   * @notice Get subject stats for a record
   */
  function getSubjectStats(
    bytes32 recordIdHash
  ) external view returns (uint256 total, uint256 active) {
    bytes32[] memory allSubjects = recordSubjects[recordIdHash];
    total = allSubjects.length;

    for (uint256 i = 0; i < allSubjects.length; i++) {
      if (isSubjectActive[recordIdHash][allSubjects[i]]) {
        active++;
      }
    }

    return (total, active);
  }

  /**
   * @notice Get all hashes (Version history) for a record
   */
  function getRecordVersionHistory(bytes32 recordIdHash) external view returns (bytes32[] memory) {
    return recordVersionHistory[recordIdHash];
  }

  /**
   * @notice Get the recordIdHash that a hash belongs to
   */
  function getRecordIdForHash(bytes32 recordHash) external view returns (bytes32) {
    require(isHashActive[recordHash], "Hash does not exist");
    return recordIdForHash[recordHash];
  }

  /**
   * @notice Check if a hash exists
   */
  function doesHashExist(bytes32 recordHash) external view returns (bool) {
    return isHashActive[recordHash];
  }

  /**
   * @notice Get the number of versions for a record
   */
  function getVersionCount(bytes32 recordIdHash) external view returns (uint256) {
    return recordVersionHistory[recordIdHash].length;
  }

  /**
   * @notice Get total number of anchored records
   */
  function getTotalAnchoredRecords() external view returns (uint256) {
    return totalAnchoredRecords;
  }

  // ===============================================================
  // RECORD REVIEWS
  // ===============================================================

  // =================== RECORD REVIEWS - EVENTS ===================

  event RecordVerified(
    bytes32 indexed recordHash,
    bytes32 indexed recordIdHash,
    bytes32 indexed verifierIdHash,
    VerificationLevel level,
    uint256 timestamp
  );

  event VerificationRetracted(
    bytes32 indexed recordHash,
    bytes32 indexed verifierIdHash,
    uint256 timestamp
  );

  event VerificationLevelModified(
    bytes32 indexed recordHash,
    bytes32 indexed verifierIdHash,
    VerificationLevel oldLevel,
    VerificationLevel newLevel,
    uint256 timestamp
  );

  event RecordDisputed(
    bytes32 indexed recordHash,
    bytes32 indexed recordIdHash,
    bytes32 indexed disputerIdHash,
    DisputeSeverity severity,
    DisputeCulpability culpability,
    uint256 timestamp
  );

  event DisputeRetracted(
    bytes32 indexed recordHash,
    bytes32 indexed disputerIdHash,
    uint256 timestamp
  );

  event DisputeModification(
    bytes32 indexed recordHash,
    bytes32 indexed disputerIdHash,
    DisputeSeverity oldSeverity,
    DisputeSeverity newSeverity,
    DisputeCulpability oldCulpability,
    DisputeCulpability newCulpability,
    uint256 timestamp
  );

  event UnacceptedUpdateFlagged(
    bytes32 indexed subjectIdHash,
    bytes32 indexed recordIdHash,
    bytes32 indexed reporterIdHash,
    bytes32 recordHash,
    uint256 timestamp
  );

  event UnacceptedUpdateFlagRevoked(
    bytes32 indexed subjectIdHash,
    bytes32 indexed recordIdHash,
    bytes32 indexed reporterIdHash,
    uint256 timestamp
  );

  // =================== RECORD REVIEWS - ENUMS ===================

  enum VerificationLevel {
    None, //For returning missing
    Provenance,
    Content,
    Full
  }

  enum DisputeSeverity {
    None, //For returning missing
    Negligible,
    Moderate,
    Major
  }

  enum DisputeCulpability {
    Unknown,
    NoFault,
    Systemic,
    Preventable,
    Reckless,
    Intentional
  }

  // =================== RECORD REVIEWS - STRUCTURES ===================

  struct Verification {
    bytes32 verifierIdHash;
    bytes32 recordIdHash;
    VerificationLevel level;
    uint256 createdAt;
    bool isActive;
  }

  struct Dispute {
    bytes32 disputerIdHash;
    bytes32 recordIdHash;
    DisputeSeverity severity;
    DisputeCulpability culpability;
    string notes;
    uint256 createdAt;
    bool isActive;
  }

  struct UnacceptedFlag {
    bytes32 recordIdHash;
    bytes32 reporterIdHash;
    bytes32 recordHash;
    uint256 createdAt;
    bool isActive;
  }

  /// @dev Return shape for getDisputesAgainstUser — a Dispute paired with which hash it targets,
  ///   since Dispute itself only carries recordIdHash (a record can have several hash versions).
  struct DisputeAgainstUser {
    bytes32 recordHash;
    bytes32 disputerIdHash;
    DisputeSeverity severity;
    DisputeCulpability culpability;
    string notes;
    uint256 createdAt;
  }

  // =================== RECORD REVIEWS - STORAGE ===================

  // Verifications: RecordHash --> Verification
  mapping(bytes32 => Verification[]) public verifications;
  mapping(bytes32 => mapping(bytes32 => bool)) public currentlyVerified;
  mapping(bytes32 => mapping(bytes32 => uint256)) public verificationIndex;

  // Disputes: RecordHash --> Dispute
  mapping(bytes32 => Dispute[]) public disputes;
  mapping(bytes32 => mapping(bytes32 => bool)) public currentlyDisputed;
  mapping(bytes32 => mapping(bytes32 => uint256)) public disputeIndex;

  //Unaccepted Update Flags: UserIdHash --> Flag
  mapping(bytes32 => UnacceptedFlag[]) public unacceptedFlagsBySubject;
  mapping(bytes32 => mapping(bytes32 => uint256)) public unacceptedFlagIndex;
  mapping(bytes32 => uint256) public activeUnacceptedFlagCount;

  // User history: UserIdHash --> recordHash from Verification/Dispute
  mapping(bytes32 => bytes32[]) public verificationsByUser;
  mapping(bytes32 => bytes32[]) public disputesByUser;

  uint256 public totalVerifications;
  uint256 public totalDisputes;
  uint256 public totalUnacceptedFlags;

  // =================== RECORD REVIEWS - FUNCTIONS ===================

  // ------------------- VERIFICATIONS -------------------

  /**
   * @notice Verify a record hash (vouch for its accuracy)
   * @param recordIdHash The recordIdHash this hash is claimed to be for
   * @param recordHash The hash being verified
   */
  function verifyRecord(
    bytes32 recordIdHash,
    bytes32 recordHash,
    uint8 level
  ) external onlyActiveMember onlyRecordParticipant(recordIdHash) {
    require(recordIdHash != bytes32(0), "Record ID cannot be empty");
    require(recordHash != bytes32(0), "Record hash cannot be empty");
    require(level >= 1 && level <= 3, "Level must be 1-3");

    bytes32 verifierIdHash = memberRoleManager.getUserForWallet(msg.sender);
    require(verifierIdHash != bytes32(0), "Wallet not registered");
    require(recordIdForHash[recordHash] == recordIdHash, "Hash does not belong to this record");
    require(!currentlyVerified[recordHash][verifierIdHash], "Already verified this hash");
    require(
      !currentlyDisputed[recordHash][verifierIdHash],
      "Cannot verify a hash you are actively disputing"
    );

    _recordVerification(recordIdHash, recordHash, verifierIdHash, level);
  }

  /**
   * @dev Shared push+index+event logic for a new verification. Used by both verifyRecord (which
   *   reverts on guard failure) and _maybeSelfVerify (which no-ops on guard failure instead).
   */
  function _recordVerification(
    bytes32 recordIdHash,
    bytes32 recordHash,
    bytes32 verifierIdHash,
    uint8 level
  ) internal {
    uint256 newIndex = verifications[recordHash].length;

    verifications[recordHash].push(
      Verification({
        verifierIdHash: verifierIdHash,
        recordIdHash: recordIdHash,
        level: VerificationLevel(level),
        createdAt: block.timestamp,
        isActive: true
      })
    );

    currentlyVerified[recordHash][verifierIdHash] = true;
    verificationIndex[recordHash][verifierIdHash] = newIndex;
    verificationsByUser[verifierIdHash].push(recordHash);
    totalVerifications++;

    emit RecordVerified(
      recordHash,
      recordIdHash,
      verifierIdHash,
      VerificationLevel(level),
      block.timestamp
    );
  }

  /**
   * @dev Best-effort self-verification nudge called from anchorRecord. Mirrors verifyRecord's
   *   guards but silently no-ops instead of reverting on failure (already verified, actively
   *   disputing this hash, or an invalid/zero level) — the nudge must never block the anchor.
   */
  function _maybeSelfVerify(
    bytes32 recordIdHash,
    bytes32 recordHash,
    bytes32 verifierIdHash,
    uint8 level
  ) internal {
    if (level < 1 || level > 3) return;
    if (recordIdForHash[recordHash] != recordIdHash) return;
    if (currentlyVerified[recordHash][verifierIdHash]) return;
    if (currentlyDisputed[recordHash][verifierIdHash]) return;

    _recordVerification(recordIdHash, recordHash, verifierIdHash, level);
  }

  /**
   * @notice Retract your verification
   * @param recordHash The hash you verified
   */
  function retractVerification(bytes32 recordHash) external {
    bytes32 verifierIdHash = memberRoleManager.getUserForWallet(msg.sender);
    require(verifierIdHash != bytes32(0), "Wallet not registered");
    require(currentlyVerified[recordHash][verifierIdHash], "No verification to retract");

    uint256 idx = verificationIndex[recordHash][verifierIdHash];
    require(verifications[recordHash][idx].isActive, "Already retracted");

    // 1. Kill the active flag in the historical array
    verifications[recordHash][idx].isActive = false;
    // 2. Reset mapping to reflect current verification state
    currentlyVerified[recordHash][verifierIdHash] = false;

    emit VerificationRetracted(recordHash, verifierIdHash, block.timestamp);
  }

  /**
   * @notice Modify your verification level
   * @param recordHash The hash you verified
   * @param newLevel New level (1-3)
   */
  function modifyVerificationLevel(bytes32 recordHash, uint8 newLevel) external {
    require(newLevel >= 1 && newLevel <= 3, "Level must be 1-3");

    bytes32 verifierIdHash = memberRoleManager.getUserForWallet(msg.sender);
    require(verifierIdHash != bytes32(0), "Wallet not registered");
    require(currentlyVerified[recordHash][verifierIdHash], "No verification to modify");

    uint256 idx = verificationIndex[recordHash][verifierIdHash];
    Verification storage verification = verifications[recordHash][idx];
    require(verification.isActive, "Verification has been retracted");

    VerificationLevel oldLevel = verification.level;
    require(oldLevel != VerificationLevel(newLevel), "Already this level");

    verification.level = VerificationLevel(newLevel);

    emit VerificationLevelModified(
      recordHash,
      verifierIdHash,
      oldLevel,
      VerificationLevel(newLevel),
      block.timestamp
    );
  }

  // ------------------- DISPUTES -------------------

  /**
   * @notice Dispute a record hash (flag it as inaccurate)
   * @param recordIdHash The record this hash is claimed to be for
   * @param recordHash The hash being disputed
   * @param severity 1=Negligible, 2=Moderate, 3=Major
   * @param culpability 0=Unknown, 1=NoFault, 2=Systemic, 3=Preventable, 4=Reckless, 5=Intentional
   * @param notes Off-chain reference for detailed reasoning (IPFS hash, etc.)
   */
  function disputeRecord(
    bytes32 recordIdHash,
    bytes32 recordHash,
    uint8 severity,
    uint8 culpability,
    string memory notes
  ) external onlyActiveMember onlyRecordParticipant(recordIdHash) {
    require(recordIdHash != bytes32(0), "Record ID cannot be empty");
    require(recordHash != bytes32(0), "Record hash cannot be empty");
    require(severity >= 1 && severity <= 3, "Severity must be 1-3");
    require(culpability <= 5, "Culpability must be 0-5");

    bytes32 disputerIdHash = memberRoleManager.getUserForWallet(msg.sender);
    require(disputerIdHash != bytes32(0), "Wallet not registered");
    require(recordIdForHash[recordHash] == recordIdHash, "Hash does not belong to this record");
    require(!currentlyDisputed[recordHash][disputerIdHash], "Already disputed this hash");
    require(
      !currentlyVerified[recordHash][disputerIdHash],
      "Cannot dispute a hash you are actively verifying"
    );

    uint256 newIndex = disputes[recordHash].length;

    disputes[recordHash].push(
      Dispute({
        disputerIdHash: disputerIdHash,
        recordIdHash: recordIdHash,
        severity: DisputeSeverity(severity),
        culpability: DisputeCulpability(culpability),
        notes: notes,
        createdAt: block.timestamp,
        isActive: true
      })
    );

    currentlyDisputed[recordHash][disputerIdHash] = true;
    disputeIndex[recordHash][disputerIdHash] = newIndex;
    disputesByUser[disputerIdHash].push(recordHash);
    totalDisputes++;

    emit RecordDisputed(
      recordHash,
      recordIdHash,
      disputerIdHash,
      DisputeSeverity(severity),
      DisputeCulpability(culpability),
      block.timestamp
    );
  }

  /**
   * @notice Retract your dispute
   * @param recordHash The hash you disputed
   */
  function retractDispute(bytes32 recordHash) external {
    bytes32 disputerIdHash = memberRoleManager.getUserForWallet(msg.sender);
    require(disputerIdHash != bytes32(0), "Wallet not registered");
    require(currentlyDisputed[recordHash][disputerIdHash], "No dispute to retract");

    uint256 idx = disputeIndex[recordHash][disputerIdHash];
    require(disputes[recordHash][idx].isActive, "Already retracted");

    disputes[recordHash][idx].isActive = false;
    currentlyDisputed[recordHash][disputerIdHash] = false;

    emit DisputeRetracted(recordHash, disputerIdHash, block.timestamp);
  }

  /**
   * @notice Modify your dispute's severity and culpability
   * @param recordHash The hash you disputed
   * @param newSeverity New severity (1-3)
   * @param newCulpability New culpability (1-5)
   */
  function modifyDispute(bytes32 recordHash, uint8 newSeverity, uint8 newCulpability) external {
    require(newSeverity >= 1 && newSeverity <= 3, "Severity must be 1-3");
    require(newCulpability <= 5, "Culpability must be 0-5");

    bytes32 disputerIdHash = memberRoleManager.getUserForWallet(msg.sender);
    require(disputerIdHash != bytes32(0), "Wallet not registered");
    require(currentlyDisputed[recordHash][disputerIdHash], "No dispute to modify");

    uint256 idx = disputeIndex[recordHash][disputerIdHash];
    Dispute storage dispute = disputes[recordHash][idx];
    require(dispute.isActive, "Dispute has been retracted");

    DisputeSeverity oldSeverity = dispute.severity;
    DisputeCulpability oldCulpability = dispute.culpability;

    require(
      oldSeverity != DisputeSeverity(newSeverity) ||
        oldCulpability != DisputeCulpability(newCulpability),
      "Values unchanged"
    );

    dispute.severity = DisputeSeverity(newSeverity);
    dispute.culpability = DisputeCulpability(newCulpability);

    emit DisputeModification(
      recordHash,
      disputerIdHash,
      oldSeverity,
      dispute.severity,
      oldCulpability,
      dispute.culpability,
      block.timestamp
    );
  }

  // ------------------- UNACCEPTED UPDATE FLAGS -------------------

  /**
   * @notice Flag that an unaccepted update exists for a record or user
   * @dev Only admin can call this to protect privacy
   * @param subjectIdHash The subject this flag is about
   * @param recordIdHash The record ID, optional if there's no recordIdHash associated to patient yet
   * @param reporterIdHash The userId of the reporter
   * @param recordHash The recordContent
   */
  function flagUnacceptedUpdate(
    bytes32 subjectIdHash,
    bytes32 recordIdHash,
    bytes32 reporterIdHash,
    bytes32 recordHash
  ) external onlyAdmin {
    require(subjectIdHash != bytes32(0), "Invalid subject");
    require(recordIdHash != bytes32(0), "Invalid record");
    require(reporterIdHash != bytes32(0), "Invalid provider");
    require(unacceptedFlagIndex[subjectIdHash][recordIdHash] == 0, "Already flagged");

    uint256 newIndex = unacceptedFlagsBySubject[subjectIdHash].length;
    unacceptedFlagIndex[subjectIdHash][recordIdHash] = newIndex + 1;

    unacceptedFlagsBySubject[subjectIdHash].push(
      UnacceptedFlag({
        recordIdHash: recordIdHash,
        reporterIdHash: reporterIdHash,
        recordHash: recordHash,
        createdAt: block.timestamp,
        isActive: true
      })
    );

    activeUnacceptedFlagCount[subjectIdHash]++;
    totalUnacceptedFlags++;

    emit UnacceptedUpdateFlagged(
      subjectIdHash,
      recordIdHash,
      reporterIdHash,
      recordHash,
      block.timestamp
    );
  }

  /**
   * @notice Resolve an unaccepted update flag
   * @dev Only admin can call this
   * @param subjectIdHash the subject this flag is about
   * @param recordIdHash The index of the flag to resolve
   */
  function revokeUnacceptedFlag(bytes32 subjectIdHash, bytes32 recordIdHash) external onlyAdmin {
    uint256 storedIndex = unacceptedFlagIndex[subjectIdHash][recordIdHash];
    require(storedIndex != 0, "No flag exists");

    uint256 idx = storedIndex - 1;
    UnacceptedFlag storage flag = unacceptedFlagsBySubject[subjectIdHash][idx];
    require(flag.isActive, "Flag already revoked");

    bytes32 reporterIdHash = flag.reporterIdHash;
    flag.isActive = false;
    activeUnacceptedFlagCount[subjectIdHash]--;

    emit UnacceptedUpdateFlagRevoked(subjectIdHash, recordIdHash, reporterIdHash, block.timestamp);
  }

  // =================== RECORD REVIEWS - VIEW FUNCTIONS ===================

  // ------------------- VERIFICATION VIEWS -------------------

  /**
   * @notice Get all verifications for a record hash
   */
  function getVerifications(bytes32 recordHash) external view returns (Verification[] memory) {
    return verifications[recordHash];
  }

  /**
   * @notice Check if a user has verified a record hash
   */
  function hasUserVerified(bytes32 recordHash, bytes32 userIdHash) external view returns (bool) {
    return currentlyVerified[recordHash][userIdHash];
  }

  /**
   * @notice Get a specific user's verification for a hash
   */
  function getUserVerification(
    bytes32 recordHash,
    bytes32 userIdHash
  )
    external
    view
    returns (
      bool exists,
      bytes32 recordIdHash,
      VerificationLevel level,
      uint256 createdAt,
      bool isActive
    )
  {
    if (!currentlyVerified[recordHash][userIdHash]) {
      return (false, bytes32(0), VerificationLevel.None, 0, false);
    }

    uint256 idx = verificationIndex[recordHash][userIdHash];
    Verification memory v = verifications[recordHash][idx];

    return (true, v.recordIdHash, v.level, v.createdAt, v.isActive);
  }

  /**
   * @notice Get verification stats for a record hash
   */
  function getVerificationStats(
    bytes32 recordHash
  ) external view returns (uint256 total, uint256 active) {
    Verification[] memory vers = verifications[recordHash];
    total = vers.length;

    for (uint256 i = 0; i < vers.length; i++) {
      if (vers[i].isActive) {
        active++;
      }
    }

    return (total, active);
  }

  /**
   * @notice Get all hashes a user has verified
   */
  function getUserVerifications(bytes32 userIdHash) external view returns (bytes32[] memory) {
    return verificationsByUser[userIdHash];
  }

  // ------------------- DISPUTE VIEWS -------------------

  /**
   * @notice Get all disputes for a record hash
   */
  function getDisputes(bytes32 recordHash) external view returns (Dispute[] memory) {
    return disputes[recordHash];
  }

  /**
   * @notice Check if a user has disputed a record hash
   */
  function hasUserDisputed(bytes32 recordHash, bytes32 userIdHash) external view returns (bool) {
    return currentlyDisputed[recordHash][userIdHash];
  }

  /**
   * @notice Get a specific user's dispute for a hash
   */
  function getUserDispute(
    bytes32 recordHash,
    bytes32 userIdHash
  )
    external
    view
    returns (
      bool exists,
      bytes32 recordIdHash,
      DisputeSeverity severity,
      DisputeCulpability culpability,
      string memory notes,
      uint256 createdAt,
      bool isActive
    )
  {
    if (!currentlyDisputed[recordHash][userIdHash]) {
      return (false, bytes32(0), DisputeSeverity.None, DisputeCulpability.Unknown, "", 0, false);
    }

    uint256 idx = disputeIndex[recordHash][userIdHash];
    Dispute memory d = disputes[recordHash][idx];

    return (true, d.recordIdHash, d.severity, d.culpability, d.notes, d.createdAt, d.isActive);
  }

  /**
   * @notice Get dispute stats for a record hash
   */
  function getDisputeStats(
    bytes32 recordHash
  ) external view returns (uint256 total, uint256 active) {
    Dispute[] memory disps = disputes[recordHash];
    total = disps.length;

    for (uint256 i = 0; i < disps.length; i++) {
      if (disps[i].isActive) {
        active++;
      }
    }

    return (total, active);
  }

  /**
   * @notice Get all hashes a user has disputed
   */
  function getUserDisputes(bytes32 userIdHash) external view returns (bytes32[] memory) {
    return disputesByUser[userIdHash];
  }

  /**
   * @notice Get every active dispute filed against any hash this user has verified
   * @dev Convenience join for the credibility system's I(u) input — active disputes against
   *   records the user has verified for the purposes of calculating CulpabilityPenalty as part of EarnedTrust.
   *   Equivalent to combining getUserVerifications(u) with getDisputes(hash) per result, provided here as a
   *   single call. For very prolific verifiers this loop can get large; bulk/network-wide computation should
   *   prefer replaying RecordVerified/RecordDisputed events instead.
   */
  function getDisputesAgainstUser(
    bytes32 userIdHash
  ) external view returns (DisputeAgainstUser[] memory) {
    bytes32[] memory verifiedHashes = verificationsByUser[userIdHash];

    uint256 total = 0;
    for (uint256 i = 0; i < verifiedHashes.length; i++) {
      Dispute[] memory hashDisputes = disputes[verifiedHashes[i]];
      for (uint256 j = 0; j < hashDisputes.length; j++) {
        if (hashDisputes[j].isActive) total++;
      }
    }

    DisputeAgainstUser[] memory result = new DisputeAgainstUser[](total);
    uint256 idx = 0;
    for (uint256 i = 0; i < verifiedHashes.length; i++) {
      Dispute[] memory hashDisputes = disputes[verifiedHashes[i]];
      for (uint256 j = 0; j < hashDisputes.length; j++) {
        if (!hashDisputes[j].isActive) continue;

        result[idx++] = DisputeAgainstUser({
          recordHash: verifiedHashes[i],
          disputerIdHash: hashDisputes[j].disputerIdHash,
          severity: hashDisputes[j].severity,
          culpability: hashDisputes[j].culpability,
          notes: hashDisputes[j].notes,
          createdAt: hashDisputes[j].createdAt
        });
      }
    }

    return result;
  }

  // ------------------- UNACCEPTED UPDATE FLAG VIEWS -------------------

  /**
   * @notice Get all flags for a subject (includes revoked, for audit trail)
   */
  function getUnacceptedFlags(
    bytes32 subjectIdHash
  ) external view returns (UnacceptedFlag[] memory) {
    return unacceptedFlagsBySubject[subjectIdHash];
  }

  /**
   * @notice Get the flag for a specific (subject, record) pair
   */
  function getUnacceptedFlag(
    bytes32 subjectIdHash,
    bytes32 recordIdHash
  )
    external
    view
    returns (
      bool exists,
      bool isActive,
      bytes32 reporterIdHash,
      bytes32 recordHash,
      uint256 createdAt
    )
  {
    uint256 storedIndex = unacceptedFlagIndex[subjectIdHash][recordIdHash];
    if (storedIndex == 0) {
      return (false, false, bytes32(0), bytes32(0), 0);
    }

    UnacceptedFlag memory flag = unacceptedFlagsBySubject[subjectIdHash][storedIndex - 1];
    return (true, flag.isActive, flag.reporterIdHash, flag.recordHash, flag.createdAt);
  }

  /**
   * @notice Get count of currently active flags for a subject
   */
  function getActiveUnacceptedFlagCount(bytes32 subjectIdHash) external view returns (uint256) {
    return activeUnacceptedFlagCount[subjectIdHash];
  }

  /**
   * @notice Check if a subject has any active flags
   */
  function hasActiveUnacceptedFlags(bytes32 subjectIdHash) external view returns (bool) {
    return activeUnacceptedFlagCount[subjectIdHash] > 0;
  }

  // ===============================================================
  // STORAGE GAP
  // Safe upgrade buffer — future versions can consume these slots
  // without shifting the storage layout of existing variables.
  // ===============================================================

  uint256[50] private __gap;
}
