import type { BaseContract, BigNumberish, BytesLike, FunctionFragment, Result, Interface, EventFragment, AddressLike, ContractRunner, ContractMethod, Listener } from "ethers";
import type { TypedContractEvent, TypedDeferredTopicFilter, TypedEventLog, TypedLogDescription, TypedListener, TypedContractMethod } from "../../common";
export interface MemberRoleManagerInterface extends Interface {
    getFunction(nameOrSignature: "UPGRADE_INTERFACE_VERSION" | "acceptTrustee" | "addMember" | "addMemberBatch" | "admin" | "adminsByRecord" | "bootstrapDependentTrustee" | "changeRole" | "changeRoleBatch" | "deactivateWallet" | "declineTrustee" | "downgradeTrusteeLevel" | "extendTrusteeGrantsOnAnchor" | "getAllRecordParticipants" | "getHealthRecordCore" | "getRecordRoleStats" | "getRoleDetails" | "getRoleDetailsByUser" | "getRoleGranter" | "getTotalUsers" | "getTrusteeGrantedRecords" | "getTrusteeRelationship" | "getTrusteesForTrustor" | "getUserForWallet" | "getUserStatus" | "getVouchStatus" | "getVouchesGiven" | "getVouchesReceived" | "getWalletsForUser" | "giveVouch" | "grantRole" | "grantRoleBatch" | "hasActiveRole" | "hasRole" | "hasVouched" | "healthRecordCore" | "initialize" | "initializeRecordRole" | "isActiveMember" | "isActiveSubject" | "isControllerOf" | "isOwnerOrAdmin" | "isVerifiedMember" | "isVerifiedProvider" | "ownersByRecord" | "proposeTrustee" | "proxiableUUID" | "reactivateWallet" | "recordRoles" | "retractTrusteeGrantsOnUnanchor" | "retractVouch" | "revokeRole" | "revokeRoleBatch" | "revokeTrustee" | "roleGrantedBy" | "setHealthRecordCore" | "setUserStatus" | "sharersByRecord" | "totalUsers" | "transferAdmin" | "trusteeRelationships" | "trusteesByTrustor" | "updateTrusteeLevel" | "upgradeToAndCall" | "userStatus" | "userWallets" | "viewersByRecord" | "voluntarilyLeaveOwnership" | "vouches" | "vouchesGiven" | "vouchesReceived" | "wallets"): FunctionFragment;
    getEvent(nameOrSignatureOrTopic: "AdminTransferred" | "HealthRecordCoreUpdated" | "Initialized" | "MemberRegistered" | "MemberStatusChanged" | "OwnershipVoluntarilyLeft" | "RoleChanged" | "RoleGranted" | "RoleRevoked" | "TrusteeAccepted" | "TrusteeDeclined" | "TrusteeLevelUpdated" | "TrusteeProposed" | "TrusteeRevoked" | "Upgraded" | "VouchGiven" | "VouchRetracted" | "WalletLinked"): EventFragment;
    encodeFunctionData(functionFragment: "UPGRADE_INTERFACE_VERSION", values?: undefined): string;
    encodeFunctionData(functionFragment: "acceptTrustee", values: [BytesLike]): string;
    encodeFunctionData(functionFragment: "addMember", values: [AddressLike, BytesLike]): string;
    encodeFunctionData(functionFragment: "addMemberBatch", values: [AddressLike[], BytesLike]): string;
    encodeFunctionData(functionFragment: "admin", values?: undefined): string;
    encodeFunctionData(functionFragment: "adminsByRecord", values: [BytesLike, BigNumberish]): string;
    encodeFunctionData(functionFragment: "bootstrapDependentTrustee", values: [BytesLike, BytesLike]): string;
    encodeFunctionData(functionFragment: "changeRole", values: [BytesLike, AddressLike, string]): string;
    encodeFunctionData(functionFragment: "changeRoleBatch", values: [BytesLike[], AddressLike, string[]]): string;
    encodeFunctionData(functionFragment: "deactivateWallet", values: [AddressLike]): string;
    encodeFunctionData(functionFragment: "declineTrustee", values: [BytesLike]): string;
    encodeFunctionData(functionFragment: "downgradeTrusteeLevel", values: [BytesLike, BigNumberish]): string;
    encodeFunctionData(functionFragment: "extendTrusteeGrantsOnAnchor", values: [BytesLike, BytesLike]): string;
    encodeFunctionData(functionFragment: "getAllRecordParticipants", values: [BytesLike]): string;
    encodeFunctionData(functionFragment: "getHealthRecordCore", values?: undefined): string;
    encodeFunctionData(functionFragment: "getRecordRoleStats", values: [BytesLike]): string;
    encodeFunctionData(functionFragment: "getRoleDetails", values: [BytesLike, AddressLike]): string;
    encodeFunctionData(functionFragment: "getRoleDetailsByUser", values: [BytesLike, BytesLike]): string;
    encodeFunctionData(functionFragment: "getRoleGranter", values: [BytesLike, BytesLike]): string;
    encodeFunctionData(functionFragment: "getTotalUsers", values?: undefined): string;
    encodeFunctionData(functionFragment: "getTrusteeGrantedRecords", values: [BytesLike, BytesLike]): string;
    encodeFunctionData(functionFragment: "getTrusteeRelationship", values: [BytesLike, BytesLike]): string;
    encodeFunctionData(functionFragment: "getTrusteesForTrustor", values: [BytesLike]): string;
    encodeFunctionData(functionFragment: "getUserForWallet", values: [AddressLike]): string;
    encodeFunctionData(functionFragment: "getUserStatus", values: [BytesLike]): string;
    encodeFunctionData(functionFragment: "getVouchStatus", values: [BytesLike, BytesLike]): string;
    encodeFunctionData(functionFragment: "getVouchesGiven", values: [BytesLike]): string;
    encodeFunctionData(functionFragment: "getVouchesReceived", values: [BytesLike]): string;
    encodeFunctionData(functionFragment: "getWalletsForUser", values: [BytesLike]): string;
    encodeFunctionData(functionFragment: "giveVouch", values: [BytesLike]): string;
    encodeFunctionData(functionFragment: "grantRole", values: [BytesLike, AddressLike, string]): string;
    encodeFunctionData(functionFragment: "grantRoleBatch", values: [BytesLike[], AddressLike, string[]]): string;
    encodeFunctionData(functionFragment: "hasActiveRole", values: [BytesLike, AddressLike]): string;
    encodeFunctionData(functionFragment: "hasRole", values: [BytesLike, AddressLike, string]): string;
    encodeFunctionData(functionFragment: "hasVouched", values: [BytesLike, BytesLike]): string;
    encodeFunctionData(functionFragment: "healthRecordCore", values?: undefined): string;
    encodeFunctionData(functionFragment: "initialize", values?: undefined): string;
    encodeFunctionData(functionFragment: "initializeRecordRole", values: [BytesLike, AddressLike, string]): string;
    encodeFunctionData(functionFragment: "isActiveMember", values: [AddressLike]): string;
    encodeFunctionData(functionFragment: "isActiveSubject", values: [BytesLike, BytesLike]): string;
    encodeFunctionData(functionFragment: "isControllerOf", values: [BytesLike, BytesLike]): string;
    encodeFunctionData(functionFragment: "isOwnerOrAdmin", values: [BytesLike, AddressLike]): string;
    encodeFunctionData(functionFragment: "isVerifiedMember", values: [AddressLike]): string;
    encodeFunctionData(functionFragment: "isVerifiedProvider", values: [AddressLike]): string;
    encodeFunctionData(functionFragment: "ownersByRecord", values: [BytesLike, BigNumberish]): string;
    encodeFunctionData(functionFragment: "proposeTrustee", values: [BytesLike, BigNumberish, BytesLike[]]): string;
    encodeFunctionData(functionFragment: "proxiableUUID", values?: undefined): string;
    encodeFunctionData(functionFragment: "reactivateWallet", values: [AddressLike]): string;
    encodeFunctionData(functionFragment: "recordRoles", values: [BytesLike]): string;
    encodeFunctionData(functionFragment: "retractTrusteeGrantsOnUnanchor", values: [BytesLike, BytesLike]): string;
    encodeFunctionData(functionFragment: "retractVouch", values: [BytesLike]): string;
    encodeFunctionData(functionFragment: "revokeRole", values: [BytesLike, AddressLike]): string;
    encodeFunctionData(functionFragment: "revokeRoleBatch", values: [BytesLike[], AddressLike]): string;
    encodeFunctionData(functionFragment: "revokeTrustee", values: [BytesLike, BytesLike]): string;
    encodeFunctionData(functionFragment: "roleGrantedBy", values: [BytesLike]): string;
    encodeFunctionData(functionFragment: "setHealthRecordCore", values: [AddressLike]): string;
    encodeFunctionData(functionFragment: "setUserStatus", values: [BytesLike, BigNumberish]): string;
    encodeFunctionData(functionFragment: "sharersByRecord", values: [BytesLike, BigNumberish]): string;
    encodeFunctionData(functionFragment: "totalUsers", values?: undefined): string;
    encodeFunctionData(functionFragment: "transferAdmin", values: [AddressLike]): string;
    encodeFunctionData(functionFragment: "trusteeRelationships", values: [BytesLike, BytesLike]): string;
    encodeFunctionData(functionFragment: "trusteesByTrustor", values: [BytesLike, BigNumberish]): string;
    encodeFunctionData(functionFragment: "updateTrusteeLevel", values: [BytesLike, BigNumberish]): string;
    encodeFunctionData(functionFragment: "upgradeToAndCall", values: [AddressLike, BytesLike]): string;
    encodeFunctionData(functionFragment: "userStatus", values: [BytesLike]): string;
    encodeFunctionData(functionFragment: "userWallets", values: [BytesLike, BigNumberish]): string;
    encodeFunctionData(functionFragment: "viewersByRecord", values: [BytesLike, BigNumberish]): string;
    encodeFunctionData(functionFragment: "voluntarilyLeaveOwnership", values: [BytesLike, string]): string;
    encodeFunctionData(functionFragment: "vouches", values: [BytesLike, BytesLike]): string;
    encodeFunctionData(functionFragment: "vouchesGiven", values: [BytesLike, BigNumberish]): string;
    encodeFunctionData(functionFragment: "vouchesReceived", values: [BytesLike, BigNumberish]): string;
    encodeFunctionData(functionFragment: "wallets", values: [AddressLike]): string;
    decodeFunctionResult(functionFragment: "UPGRADE_INTERFACE_VERSION", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "acceptTrustee", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "addMember", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "addMemberBatch", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "admin", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "adminsByRecord", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "bootstrapDependentTrustee", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "changeRole", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "changeRoleBatch", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "deactivateWallet", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "declineTrustee", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "downgradeTrusteeLevel", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "extendTrusteeGrantsOnAnchor", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "getAllRecordParticipants", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "getHealthRecordCore", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "getRecordRoleStats", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "getRoleDetails", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "getRoleDetailsByUser", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "getRoleGranter", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "getTotalUsers", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "getTrusteeGrantedRecords", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "getTrusteeRelationship", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "getTrusteesForTrustor", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "getUserForWallet", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "getUserStatus", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "getVouchStatus", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "getVouchesGiven", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "getVouchesReceived", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "getWalletsForUser", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "giveVouch", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "grantRole", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "grantRoleBatch", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "hasActiveRole", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "hasRole", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "hasVouched", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "healthRecordCore", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "initialize", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "initializeRecordRole", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "isActiveMember", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "isActiveSubject", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "isControllerOf", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "isOwnerOrAdmin", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "isVerifiedMember", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "isVerifiedProvider", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "ownersByRecord", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "proposeTrustee", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "proxiableUUID", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "reactivateWallet", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "recordRoles", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "retractTrusteeGrantsOnUnanchor", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "retractVouch", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "revokeRole", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "revokeRoleBatch", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "revokeTrustee", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "roleGrantedBy", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "setHealthRecordCore", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "setUserStatus", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "sharersByRecord", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "totalUsers", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "transferAdmin", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "trusteeRelationships", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "trusteesByTrustor", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "updateTrusteeLevel", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "upgradeToAndCall", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "userStatus", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "userWallets", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "viewersByRecord", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "voluntarilyLeaveOwnership", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "vouches", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "vouchesGiven", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "vouchesReceived", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "wallets", data: BytesLike): Result;
}
export declare namespace AdminTransferredEvent {
    type InputTuple = [
        oldAdmin: AddressLike,
        newAdmin: AddressLike,
        timestamp: BigNumberish
    ];
    type OutputTuple = [
        oldAdmin: string,
        newAdmin: string,
        timestamp: bigint
    ];
    interface OutputObject {
        oldAdmin: string;
        newAdmin: string;
        timestamp: bigint;
    }
    type Event = TypedContractEvent<InputTuple, OutputTuple, OutputObject>;
    type Filter = TypedDeferredTopicFilter<Event>;
    type Log = TypedEventLog<Event>;
    type LogDescription = TypedLogDescription<Event>;
}
export declare namespace HealthRecordCoreUpdatedEvent {
    type InputTuple = [newAddress: AddressLike, timestamp: BigNumberish];
    type OutputTuple = [newAddress: string, timestamp: bigint];
    interface OutputObject {
        newAddress: string;
        timestamp: bigint;
    }
    type Event = TypedContractEvent<InputTuple, OutputTuple, OutputObject>;
    type Filter = TypedDeferredTopicFilter<Event>;
    type Log = TypedEventLog<Event>;
    type LogDescription = TypedLogDescription<Event>;
}
export declare namespace InitializedEvent {
    type InputTuple = [version: BigNumberish];
    type OutputTuple = [version: bigint];
    interface OutputObject {
        version: bigint;
    }
    type Event = TypedContractEvent<InputTuple, OutputTuple, OutputObject>;
    type Filter = TypedDeferredTopicFilter<Event>;
    type Log = TypedEventLog<Event>;
    type LogDescription = TypedLogDescription<Event>;
}
export declare namespace MemberRegisteredEvent {
    type InputTuple = [
        wallet: AddressLike,
        userIdHash: BytesLike,
        timestamp: BigNumberish
    ];
    type OutputTuple = [
        wallet: string,
        userIdHash: string,
        timestamp: bigint
    ];
    interface OutputObject {
        wallet: string;
        userIdHash: string;
        timestamp: bigint;
    }
    type Event = TypedContractEvent<InputTuple, OutputTuple, OutputObject>;
    type Filter = TypedDeferredTopicFilter<Event>;
    type Log = TypedEventLog<Event>;
    type LogDescription = TypedLogDescription<Event>;
}
export declare namespace MemberStatusChangedEvent {
    type InputTuple = [
        userIdHash: BytesLike,
        oldStatus: BigNumberish,
        newStatus: BigNumberish,
        changedBy: AddressLike,
        timestamp: BigNumberish
    ];
    type OutputTuple = [
        userIdHash: string,
        oldStatus: bigint,
        newStatus: bigint,
        changedBy: string,
        timestamp: bigint
    ];
    interface OutputObject {
        userIdHash: string;
        oldStatus: bigint;
        newStatus: bigint;
        changedBy: string;
        timestamp: bigint;
    }
    type Event = TypedContractEvent<InputTuple, OutputTuple, OutputObject>;
    type Filter = TypedDeferredTopicFilter<Event>;
    type Log = TypedEventLog<Event>;
    type LogDescription = TypedLogDescription<Event>;
}
export declare namespace OwnershipVoluntarilyLeftEvent {
    type InputTuple = [
        recordIdHash: BytesLike,
        userIdHash: BytesLike,
        timestamp: BigNumberish
    ];
    type OutputTuple = [
        recordIdHash: string,
        userIdHash: string,
        timestamp: bigint
    ];
    interface OutputObject {
        recordIdHash: string;
        userIdHash: string;
        timestamp: bigint;
    }
    type Event = TypedContractEvent<InputTuple, OutputTuple, OutputObject>;
    type Filter = TypedDeferredTopicFilter<Event>;
    type Log = TypedEventLog<Event>;
    type LogDescription = TypedLogDescription<Event>;
}
export declare namespace RoleChangedEvent {
    type InputTuple = [
        recordIdHash: BytesLike,
        targetIdHash: BytesLike,
        oldRole: string,
        newRole: string,
        userIdHash: BytesLike,
        timestamp: BigNumberish
    ];
    type OutputTuple = [
        recordIdHash: string,
        targetIdHash: string,
        oldRole: string,
        newRole: string,
        userIdHash: string,
        timestamp: bigint
    ];
    interface OutputObject {
        recordIdHash: string;
        targetIdHash: string;
        oldRole: string;
        newRole: string;
        userIdHash: string;
        timestamp: bigint;
    }
    type Event = TypedContractEvent<InputTuple, OutputTuple, OutputObject>;
    type Filter = TypedDeferredTopicFilter<Event>;
    type Log = TypedEventLog<Event>;
    type LogDescription = TypedLogDescription<Event>;
}
export declare namespace RoleGrantedEvent {
    type InputTuple = [
        recordIdHash: BytesLike,
        targetIdHash: BytesLike,
        role: string,
        userIdHash: BytesLike,
        timestamp: BigNumberish
    ];
    type OutputTuple = [
        recordIdHash: string,
        targetIdHash: string,
        role: string,
        userIdHash: string,
        timestamp: bigint
    ];
    interface OutputObject {
        recordIdHash: string;
        targetIdHash: string;
        role: string;
        userIdHash: string;
        timestamp: bigint;
    }
    type Event = TypedContractEvent<InputTuple, OutputTuple, OutputObject>;
    type Filter = TypedDeferredTopicFilter<Event>;
    type Log = TypedEventLog<Event>;
    type LogDescription = TypedLogDescription<Event>;
}
export declare namespace RoleRevokedEvent {
    type InputTuple = [
        recordIdHash: BytesLike,
        targetIdHash: BytesLike,
        role: string,
        userIdHash: BytesLike,
        timestamp: BigNumberish
    ];
    type OutputTuple = [
        recordIdHash: string,
        targetIdHash: string,
        role: string,
        userIdHash: string,
        timestamp: bigint
    ];
    interface OutputObject {
        recordIdHash: string;
        targetIdHash: string;
        role: string;
        userIdHash: string;
        timestamp: bigint;
    }
    type Event = TypedContractEvent<InputTuple, OutputTuple, OutputObject>;
    type Filter = TypedDeferredTopicFilter<Event>;
    type Log = TypedEventLog<Event>;
    type LogDescription = TypedLogDescription<Event>;
}
export declare namespace TrusteeAcceptedEvent {
    type InputTuple = [
        trustorIdHash: BytesLike,
        trusteeIdHash: BytesLike,
        level: BigNumberish,
        timestamp: BigNumberish
    ];
    type OutputTuple = [
        trustorIdHash: string,
        trusteeIdHash: string,
        level: bigint,
        timestamp: bigint
    ];
    interface OutputObject {
        trustorIdHash: string;
        trusteeIdHash: string;
        level: bigint;
        timestamp: bigint;
    }
    type Event = TypedContractEvent<InputTuple, OutputTuple, OutputObject>;
    type Filter = TypedDeferredTopicFilter<Event>;
    type Log = TypedEventLog<Event>;
    type LogDescription = TypedLogDescription<Event>;
}
export declare namespace TrusteeDeclinedEvent {
    type InputTuple = [
        trustorIdHash: BytesLike,
        trusteeIdHash: BytesLike,
        timestamp: BigNumberish
    ];
    type OutputTuple = [
        trustorIdHash: string,
        trusteeIdHash: string,
        timestamp: bigint
    ];
    interface OutputObject {
        trustorIdHash: string;
        trusteeIdHash: string;
        timestamp: bigint;
    }
    type Event = TypedContractEvent<InputTuple, OutputTuple, OutputObject>;
    type Filter = TypedDeferredTopicFilter<Event>;
    type Log = TypedEventLog<Event>;
    type LogDescription = TypedLogDescription<Event>;
}
export declare namespace TrusteeLevelUpdatedEvent {
    type InputTuple = [
        trustorIdHash: BytesLike,
        trusteeIdHash: BytesLike,
        oldLevel: BigNumberish,
        newLevel: BigNumberish,
        timestamp: BigNumberish
    ];
    type OutputTuple = [
        trustorIdHash: string,
        trusteeIdHash: string,
        oldLevel: bigint,
        newLevel: bigint,
        timestamp: bigint
    ];
    interface OutputObject {
        trustorIdHash: string;
        trusteeIdHash: string;
        oldLevel: bigint;
        newLevel: bigint;
        timestamp: bigint;
    }
    type Event = TypedContractEvent<InputTuple, OutputTuple, OutputObject>;
    type Filter = TypedDeferredTopicFilter<Event>;
    type Log = TypedEventLog<Event>;
    type LogDescription = TypedLogDescription<Event>;
}
export declare namespace TrusteeProposedEvent {
    type InputTuple = [
        trustorIdHash: BytesLike,
        trusteeIdHash: BytesLike,
        level: BigNumberish,
        timestamp: BigNumberish
    ];
    type OutputTuple = [
        trustorIdHash: string,
        trusteeIdHash: string,
        level: bigint,
        timestamp: bigint
    ];
    interface OutputObject {
        trustorIdHash: string;
        trusteeIdHash: string;
        level: bigint;
        timestamp: bigint;
    }
    type Event = TypedContractEvent<InputTuple, OutputTuple, OutputObject>;
    type Filter = TypedDeferredTopicFilter<Event>;
    type Log = TypedEventLog<Event>;
    type LogDescription = TypedLogDescription<Event>;
}
export declare namespace TrusteeRevokedEvent {
    type InputTuple = [
        trustorIdHash: BytesLike,
        trusteeIdHash: BytesLike,
        revokedBy: BytesLike,
        timestamp: BigNumberish
    ];
    type OutputTuple = [
        trustorIdHash: string,
        trusteeIdHash: string,
        revokedBy: string,
        timestamp: bigint
    ];
    interface OutputObject {
        trustorIdHash: string;
        trusteeIdHash: string;
        revokedBy: string;
        timestamp: bigint;
    }
    type Event = TypedContractEvent<InputTuple, OutputTuple, OutputObject>;
    type Filter = TypedDeferredTopicFilter<Event>;
    type Log = TypedEventLog<Event>;
    type LogDescription = TypedLogDescription<Event>;
}
export declare namespace UpgradedEvent {
    type InputTuple = [implementation: AddressLike];
    type OutputTuple = [implementation: string];
    interface OutputObject {
        implementation: string;
    }
    type Event = TypedContractEvent<InputTuple, OutputTuple, OutputObject>;
    type Filter = TypedDeferredTopicFilter<Event>;
    type Log = TypedEventLog<Event>;
    type LogDescription = TypedLogDescription<Event>;
}
export declare namespace VouchGivenEvent {
    type InputTuple = [
        voucherIdHash: BytesLike,
        voucheeIdHash: BytesLike,
        timestamp: BigNumberish
    ];
    type OutputTuple = [
        voucherIdHash: string,
        voucheeIdHash: string,
        timestamp: bigint
    ];
    interface OutputObject {
        voucherIdHash: string;
        voucheeIdHash: string;
        timestamp: bigint;
    }
    type Event = TypedContractEvent<InputTuple, OutputTuple, OutputObject>;
    type Filter = TypedDeferredTopicFilter<Event>;
    type Log = TypedEventLog<Event>;
    type LogDescription = TypedLogDescription<Event>;
}
export declare namespace VouchRetractedEvent {
    type InputTuple = [
        voucherIdHash: BytesLike,
        voucheeIdHash: BytesLike,
        timestamp: BigNumberish
    ];
    type OutputTuple = [
        voucherIdHash: string,
        voucheeIdHash: string,
        timestamp: bigint
    ];
    interface OutputObject {
        voucherIdHash: string;
        voucheeIdHash: string;
        timestamp: bigint;
    }
    type Event = TypedContractEvent<InputTuple, OutputTuple, OutputObject>;
    type Filter = TypedDeferredTopicFilter<Event>;
    type Log = TypedEventLog<Event>;
    type LogDescription = TypedLogDescription<Event>;
}
export declare namespace WalletLinkedEvent {
    type InputTuple = [
        wallet: AddressLike,
        userIdHash: BytesLike,
        timestamp: BigNumberish
    ];
    type OutputTuple = [
        wallet: string,
        userIdHash: string,
        timestamp: bigint
    ];
    interface OutputObject {
        wallet: string;
        userIdHash: string;
        timestamp: bigint;
    }
    type Event = TypedContractEvent<InputTuple, OutputTuple, OutputObject>;
    type Filter = TypedDeferredTopicFilter<Event>;
    type Log = TypedEventLog<Event>;
    type LogDescription = TypedLogDescription<Event>;
}
export interface MemberRoleManager extends BaseContract {
    connect(runner?: ContractRunner | null): MemberRoleManager;
    waitForDeployment(): Promise<this>;
    interface: MemberRoleManagerInterface;
    queryFilter<TCEvent extends TypedContractEvent>(event: TCEvent, fromBlockOrBlockhash?: string | number | undefined, toBlock?: string | number | undefined): Promise<Array<TypedEventLog<TCEvent>>>;
    queryFilter<TCEvent extends TypedContractEvent>(filter: TypedDeferredTopicFilter<TCEvent>, fromBlockOrBlockhash?: string | number | undefined, toBlock?: string | number | undefined): Promise<Array<TypedEventLog<TCEvent>>>;
    on<TCEvent extends TypedContractEvent>(event: TCEvent, listener: TypedListener<TCEvent>): Promise<this>;
    on<TCEvent extends TypedContractEvent>(filter: TypedDeferredTopicFilter<TCEvent>, listener: TypedListener<TCEvent>): Promise<this>;
    once<TCEvent extends TypedContractEvent>(event: TCEvent, listener: TypedListener<TCEvent>): Promise<this>;
    once<TCEvent extends TypedContractEvent>(filter: TypedDeferredTopicFilter<TCEvent>, listener: TypedListener<TCEvent>): Promise<this>;
    listeners<TCEvent extends TypedContractEvent>(event: TCEvent): Promise<Array<TypedListener<TCEvent>>>;
    listeners(eventName?: string): Promise<Array<Listener>>;
    removeAllListeners<TCEvent extends TypedContractEvent>(event?: TCEvent): Promise<this>;
    UPGRADE_INTERFACE_VERSION: TypedContractMethod<[], [string], "view">;
    acceptTrustee: TypedContractMethod<[
        trustorIdHash: BytesLike
    ], [
        void
    ], "nonpayable">;
    addMember: TypedContractMethod<[
        wallet: AddressLike,
        userIdHash: BytesLike
    ], [
        void
    ], "nonpayable">;
    addMemberBatch: TypedContractMethod<[
        walletAddresses: AddressLike[],
        userIdHash: BytesLike
    ], [
        void
    ], "nonpayable">;
    admin: TypedContractMethod<[], [string], "view">;
    adminsByRecord: TypedContractMethod<[
        arg0: BytesLike,
        arg1: BigNumberish
    ], [
        string
    ], "view">;
    bootstrapDependentTrustee: TypedContractMethod<[
        trustorIdHash: BytesLike,
        trusteeIdHash: BytesLike
    ], [
        void
    ], "nonpayable">;
    changeRole: TypedContractMethod<[
        recordIdHash: BytesLike,
        targetWallet: AddressLike,
        newRole: string
    ], [
        void
    ], "nonpayable">;
    changeRoleBatch: TypedContractMethod<[
        recordIdHashes: BytesLike[],
        targetWallet: AddressLike,
        newRoles: string[]
    ], [
        void
    ], "nonpayable">;
    deactivateWallet: TypedContractMethod<[
        wallet: AddressLike
    ], [
        void
    ], "nonpayable">;
    declineTrustee: TypedContractMethod<[
        trustorIdHash: BytesLike
    ], [
        void
    ], "nonpayable">;
    downgradeTrusteeLevel: TypedContractMethod<[
        trustorIdHash: BytesLike,
        newLevel: BigNumberish
    ], [
        void
    ], "nonpayable">;
    extendTrusteeGrantsOnAnchor: TypedContractMethod<[
        subjectIdHash: BytesLike,
        recordIdHash: BytesLike
    ], [
        void
    ], "nonpayable">;
    getAllRecordParticipants: TypedContractMethod<[
        recordIdHash: BytesLike
    ], [
        [
            string[],
            string[],
            string[],
            string[]
        ] & {
            owners: string[];
            admins: string[];
            sharers: string[];
            viewers: string[];
        }
    ], "view">;
    getHealthRecordCore: TypedContractMethod<[], [string], "view">;
    getRecordRoleStats: TypedContractMethod<[
        recordIdHash: BytesLike
    ], [
        [
            bigint,
            bigint,
            bigint,
            bigint
        ] & {
            ownerCount: bigint;
            adminCount: bigint;
            sharerCount: bigint;
            viewerCount: bigint;
        }
    ], "view">;
    getRoleDetails: TypedContractMethod<[
        recordIdHash: BytesLike,
        wallet: AddressLike
    ], [
        [string, boolean] & {
            role: string;
            isActive: boolean;
        }
    ], "view">;
    getRoleDetailsByUser: TypedContractMethod<[
        recordIdHash: BytesLike,
        userIdHash: BytesLike
    ], [
        [string, boolean] & {
            role: string;
            isActive: boolean;
        }
    ], "view">;
    getRoleGranter: TypedContractMethod<[
        recordIdHash: BytesLike,
        userIdHash: BytesLike
    ], [
        string
    ], "view">;
    getTotalUsers: TypedContractMethod<[], [bigint], "view">;
    getTrusteeGrantedRecords: TypedContractMethod<[
        trustorIdHash: BytesLike,
        trusteeIdHash: BytesLike
    ], [
        string[]
    ], "view">;
    getTrusteeRelationship: TypedContractMethod<[
        trustorIdHash: BytesLike,
        trusteeIdHash: BytesLike
    ], [
        [bigint, bigint] & {
            status: bigint;
            level: bigint;
        }
    ], "view">;
    getTrusteesForTrustor: TypedContractMethod<[
        trustorIdHash: BytesLike
    ], [
        string[]
    ], "view">;
    getUserForWallet: TypedContractMethod<[
        wallet: AddressLike
    ], [
        string
    ], "view">;
    getUserStatus: TypedContractMethod<[userIdHash: BytesLike], [bigint], "view">;
    getVouchStatus: TypedContractMethod<[
        voucherIdHash: BytesLike,
        voucheeIdHash: BytesLike
    ], [
        bigint
    ], "view">;
    getVouchesGiven: TypedContractMethod<[
        voucherIdHash: BytesLike
    ], [
        string[]
    ], "view">;
    getVouchesReceived: TypedContractMethod<[
        voucheeIdHash: BytesLike
    ], [
        string[]
    ], "view">;
    getWalletsForUser: TypedContractMethod<[
        userIdHash: BytesLike
    ], [
        string[]
    ], "view">;
    giveVouch: TypedContractMethod<[
        voucheeIdHash: BytesLike
    ], [
        void
    ], "nonpayable">;
    grantRole: TypedContractMethod<[
        recordIdHash: BytesLike,
        targetWallet: AddressLike,
        role: string
    ], [
        void
    ], "nonpayable">;
    grantRoleBatch: TypedContractMethod<[
        recordIdHashes: BytesLike[],
        targetWallet: AddressLike,
        roles: string[]
    ], [
        void
    ], "nonpayable">;
    hasActiveRole: TypedContractMethod<[
        recordIdHash: BytesLike,
        wallet: AddressLike
    ], [
        boolean
    ], "view">;
    hasRole: TypedContractMethod<[
        recordIdHash: BytesLike,
        wallet: AddressLike,
        role: string
    ], [
        boolean
    ], "view">;
    hasVouched: TypedContractMethod<[
        voucherIdHash: BytesLike,
        voucheeIdHash: BytesLike
    ], [
        boolean
    ], "view">;
    healthRecordCore: TypedContractMethod<[], [string], "view">;
    initialize: TypedContractMethod<[], [void], "nonpayable">;
    initializeRecordRole: TypedContractMethod<[
        recordIdHash: BytesLike,
        targetWallet: AddressLike,
        role: string
    ], [
        void
    ], "nonpayable">;
    isActiveMember: TypedContractMethod<[wallet: AddressLike], [boolean], "view">;
    isActiveSubject: TypedContractMethod<[
        recordIdHash: BytesLike,
        userIdHash: BytesLike
    ], [
        boolean
    ], "view">;
    isControllerOf: TypedContractMethod<[
        trustorIdHash: BytesLike,
        trusteeIdHash: BytesLike
    ], [
        boolean
    ], "view">;
    isOwnerOrAdmin: TypedContractMethod<[
        recordIdHash: BytesLike,
        wallet: AddressLike
    ], [
        boolean
    ], "view">;
    isVerifiedMember: TypedContractMethod<[
        wallet: AddressLike
    ], [
        boolean
    ], "view">;
    isVerifiedProvider: TypedContractMethod<[
        wallet: AddressLike
    ], [
        boolean
    ], "view">;
    ownersByRecord: TypedContractMethod<[
        arg0: BytesLike,
        arg1: BigNumberish
    ], [
        string
    ], "view">;
    proposeTrustee: TypedContractMethod<[
        trusteeIdHash: BytesLike,
        level: BigNumberish,
        recordIdHashes: BytesLike[]
    ], [
        void
    ], "nonpayable">;
    proxiableUUID: TypedContractMethod<[], [string], "view">;
    reactivateWallet: TypedContractMethod<[
        wallet: AddressLike
    ], [
        void
    ], "nonpayable">;
    recordRoles: TypedContractMethod<[
        arg0: BytesLike
    ], [
        [string, boolean] & {
            role: string;
            isActive: boolean;
        }
    ], "view">;
    retractTrusteeGrantsOnUnanchor: TypedContractMethod<[
        subjectIdHash: BytesLike,
        recordIdHash: BytesLike
    ], [
        void
    ], "nonpayable">;
    retractVouch: TypedContractMethod<[
        voucheeIdHash: BytesLike
    ], [
        void
    ], "nonpayable">;
    revokeRole: TypedContractMethod<[
        recordIdHash: BytesLike,
        targetWallet: AddressLike
    ], [
        void
    ], "nonpayable">;
    revokeRoleBatch: TypedContractMethod<[
        recordIdHashes: BytesLike[],
        targetWallet: AddressLike
    ], [
        void
    ], "nonpayable">;
    revokeTrustee: TypedContractMethod<[
        trustorIdHash: BytesLike,
        trusteeIdHash: BytesLike
    ], [
        void
    ], "nonpayable">;
    roleGrantedBy: TypedContractMethod<[arg0: BytesLike], [string], "view">;
    setHealthRecordCore: TypedContractMethod<[
        _healthRecordCore: AddressLike
    ], [
        void
    ], "nonpayable">;
    setUserStatus: TypedContractMethod<[
        userIdHash: BytesLike,
        newStatus: BigNumberish
    ], [
        void
    ], "nonpayable">;
    sharersByRecord: TypedContractMethod<[
        arg0: BytesLike,
        arg1: BigNumberish
    ], [
        string
    ], "view">;
    totalUsers: TypedContractMethod<[], [bigint], "view">;
    transferAdmin: TypedContractMethod<[
        newAdmin: AddressLike
    ], [
        void
    ], "nonpayable">;
    trusteeRelationships: TypedContractMethod<[
        arg0: BytesLike,
        arg1: BytesLike
    ], [
        [bigint, bigint] & {
            status: bigint;
            level: bigint;
        }
    ], "view">;
    trusteesByTrustor: TypedContractMethod<[
        arg0: BytesLike,
        arg1: BigNumberish
    ], [
        string
    ], "view">;
    updateTrusteeLevel: TypedContractMethod<[
        trusteeIdHash: BytesLike,
        newLevel: BigNumberish
    ], [
        void
    ], "nonpayable">;
    upgradeToAndCall: TypedContractMethod<[
        newImplementation: AddressLike,
        data: BytesLike
    ], [
        void
    ], "payable">;
    userStatus: TypedContractMethod<[arg0: BytesLike], [bigint], "view">;
    userWallets: TypedContractMethod<[
        arg0: BytesLike,
        arg1: BigNumberish
    ], [
        string
    ], "view">;
    viewersByRecord: TypedContractMethod<[
        arg0: BytesLike,
        arg1: BigNumberish
    ], [
        string
    ], "view">;
    voluntarilyLeaveOwnership: TypedContractMethod<[
        recordIdHash: BytesLike,
        newRole: string
    ], [
        void
    ], "nonpayable">;
    vouches: TypedContractMethod<[
        arg0: BytesLike,
        arg1: BytesLike
    ], [
        bigint
    ], "view">;
    vouchesGiven: TypedContractMethod<[
        arg0: BytesLike,
        arg1: BigNumberish
    ], [
        string
    ], "view">;
    vouchesReceived: TypedContractMethod<[
        arg0: BytesLike,
        arg1: BigNumberish
    ], [
        string
    ], "view">;
    wallets: TypedContractMethod<[
        arg0: AddressLike
    ], [
        [string, boolean] & {
            userIdHash: string;
            isWalletActive: boolean;
        }
    ], "view">;
    getFunction<T extends ContractMethod = ContractMethod>(key: string | FunctionFragment): T;
    getFunction(nameOrSignature: "UPGRADE_INTERFACE_VERSION"): TypedContractMethod<[], [string], "view">;
    getFunction(nameOrSignature: "acceptTrustee"): TypedContractMethod<[trustorIdHash: BytesLike], [void], "nonpayable">;
    getFunction(nameOrSignature: "addMember"): TypedContractMethod<[
        wallet: AddressLike,
        userIdHash: BytesLike
    ], [
        void
    ], "nonpayable">;
    getFunction(nameOrSignature: "addMemberBatch"): TypedContractMethod<[
        walletAddresses: AddressLike[],
        userIdHash: BytesLike
    ], [
        void
    ], "nonpayable">;
    getFunction(nameOrSignature: "admin"): TypedContractMethod<[], [string], "view">;
    getFunction(nameOrSignature: "adminsByRecord"): TypedContractMethod<[
        arg0: BytesLike,
        arg1: BigNumberish
    ], [
        string
    ], "view">;
    getFunction(nameOrSignature: "bootstrapDependentTrustee"): TypedContractMethod<[
        trustorIdHash: BytesLike,
        trusteeIdHash: BytesLike
    ], [
        void
    ], "nonpayable">;
    getFunction(nameOrSignature: "changeRole"): TypedContractMethod<[
        recordIdHash: BytesLike,
        targetWallet: AddressLike,
        newRole: string
    ], [
        void
    ], "nonpayable">;
    getFunction(nameOrSignature: "changeRoleBatch"): TypedContractMethod<[
        recordIdHashes: BytesLike[],
        targetWallet: AddressLike,
        newRoles: string[]
    ], [
        void
    ], "nonpayable">;
    getFunction(nameOrSignature: "deactivateWallet"): TypedContractMethod<[wallet: AddressLike], [void], "nonpayable">;
    getFunction(nameOrSignature: "declineTrustee"): TypedContractMethod<[trustorIdHash: BytesLike], [void], "nonpayable">;
    getFunction(nameOrSignature: "downgradeTrusteeLevel"): TypedContractMethod<[
        trustorIdHash: BytesLike,
        newLevel: BigNumberish
    ], [
        void
    ], "nonpayable">;
    getFunction(nameOrSignature: "extendTrusteeGrantsOnAnchor"): TypedContractMethod<[
        subjectIdHash: BytesLike,
        recordIdHash: BytesLike
    ], [
        void
    ], "nonpayable">;
    getFunction(nameOrSignature: "getAllRecordParticipants"): TypedContractMethod<[
        recordIdHash: BytesLike
    ], [
        [
            string[],
            string[],
            string[],
            string[]
        ] & {
            owners: string[];
            admins: string[];
            sharers: string[];
            viewers: string[];
        }
    ], "view">;
    getFunction(nameOrSignature: "getHealthRecordCore"): TypedContractMethod<[], [string], "view">;
    getFunction(nameOrSignature: "getRecordRoleStats"): TypedContractMethod<[
        recordIdHash: BytesLike
    ], [
        [
            bigint,
            bigint,
            bigint,
            bigint
        ] & {
            ownerCount: bigint;
            adminCount: bigint;
            sharerCount: bigint;
            viewerCount: bigint;
        }
    ], "view">;
    getFunction(nameOrSignature: "getRoleDetails"): TypedContractMethod<[
        recordIdHash: BytesLike,
        wallet: AddressLike
    ], [
        [string, boolean] & {
            role: string;
            isActive: boolean;
        }
    ], "view">;
    getFunction(nameOrSignature: "getRoleDetailsByUser"): TypedContractMethod<[
        recordIdHash: BytesLike,
        userIdHash: BytesLike
    ], [
        [string, boolean] & {
            role: string;
            isActive: boolean;
        }
    ], "view">;
    getFunction(nameOrSignature: "getRoleGranter"): TypedContractMethod<[
        recordIdHash: BytesLike,
        userIdHash: BytesLike
    ], [
        string
    ], "view">;
    getFunction(nameOrSignature: "getTotalUsers"): TypedContractMethod<[], [bigint], "view">;
    getFunction(nameOrSignature: "getTrusteeGrantedRecords"): TypedContractMethod<[
        trustorIdHash: BytesLike,
        trusteeIdHash: BytesLike
    ], [
        string[]
    ], "view">;
    getFunction(nameOrSignature: "getTrusteeRelationship"): TypedContractMethod<[
        trustorIdHash: BytesLike,
        trusteeIdHash: BytesLike
    ], [
        [bigint, bigint] & {
            status: bigint;
            level: bigint;
        }
    ], "view">;
    getFunction(nameOrSignature: "getTrusteesForTrustor"): TypedContractMethod<[trustorIdHash: BytesLike], [string[]], "view">;
    getFunction(nameOrSignature: "getUserForWallet"): TypedContractMethod<[wallet: AddressLike], [string], "view">;
    getFunction(nameOrSignature: "getUserStatus"): TypedContractMethod<[userIdHash: BytesLike], [bigint], "view">;
    getFunction(nameOrSignature: "getVouchStatus"): TypedContractMethod<[
        voucherIdHash: BytesLike,
        voucheeIdHash: BytesLike
    ], [
        bigint
    ], "view">;
    getFunction(nameOrSignature: "getVouchesGiven"): TypedContractMethod<[voucherIdHash: BytesLike], [string[]], "view">;
    getFunction(nameOrSignature: "getVouchesReceived"): TypedContractMethod<[voucheeIdHash: BytesLike], [string[]], "view">;
    getFunction(nameOrSignature: "getWalletsForUser"): TypedContractMethod<[userIdHash: BytesLike], [string[]], "view">;
    getFunction(nameOrSignature: "giveVouch"): TypedContractMethod<[voucheeIdHash: BytesLike], [void], "nonpayable">;
    getFunction(nameOrSignature: "grantRole"): TypedContractMethod<[
        recordIdHash: BytesLike,
        targetWallet: AddressLike,
        role: string
    ], [
        void
    ], "nonpayable">;
    getFunction(nameOrSignature: "grantRoleBatch"): TypedContractMethod<[
        recordIdHashes: BytesLike[],
        targetWallet: AddressLike,
        roles: string[]
    ], [
        void
    ], "nonpayable">;
    getFunction(nameOrSignature: "hasActiveRole"): TypedContractMethod<[
        recordIdHash: BytesLike,
        wallet: AddressLike
    ], [
        boolean
    ], "view">;
    getFunction(nameOrSignature: "hasRole"): TypedContractMethod<[
        recordIdHash: BytesLike,
        wallet: AddressLike,
        role: string
    ], [
        boolean
    ], "view">;
    getFunction(nameOrSignature: "hasVouched"): TypedContractMethod<[
        voucherIdHash: BytesLike,
        voucheeIdHash: BytesLike
    ], [
        boolean
    ], "view">;
    getFunction(nameOrSignature: "healthRecordCore"): TypedContractMethod<[], [string], "view">;
    getFunction(nameOrSignature: "initialize"): TypedContractMethod<[], [void], "nonpayable">;
    getFunction(nameOrSignature: "initializeRecordRole"): TypedContractMethod<[
        recordIdHash: BytesLike,
        targetWallet: AddressLike,
        role: string
    ], [
        void
    ], "nonpayable">;
    getFunction(nameOrSignature: "isActiveMember"): TypedContractMethod<[wallet: AddressLike], [boolean], "view">;
    getFunction(nameOrSignature: "isActiveSubject"): TypedContractMethod<[
        recordIdHash: BytesLike,
        userIdHash: BytesLike
    ], [
        boolean
    ], "view">;
    getFunction(nameOrSignature: "isControllerOf"): TypedContractMethod<[
        trustorIdHash: BytesLike,
        trusteeIdHash: BytesLike
    ], [
        boolean
    ], "view">;
    getFunction(nameOrSignature: "isOwnerOrAdmin"): TypedContractMethod<[
        recordIdHash: BytesLike,
        wallet: AddressLike
    ], [
        boolean
    ], "view">;
    getFunction(nameOrSignature: "isVerifiedMember"): TypedContractMethod<[wallet: AddressLike], [boolean], "view">;
    getFunction(nameOrSignature: "isVerifiedProvider"): TypedContractMethod<[wallet: AddressLike], [boolean], "view">;
    getFunction(nameOrSignature: "ownersByRecord"): TypedContractMethod<[
        arg0: BytesLike,
        arg1: BigNumberish
    ], [
        string
    ], "view">;
    getFunction(nameOrSignature: "proposeTrustee"): TypedContractMethod<[
        trusteeIdHash: BytesLike,
        level: BigNumberish,
        recordIdHashes: BytesLike[]
    ], [
        void
    ], "nonpayable">;
    getFunction(nameOrSignature: "proxiableUUID"): TypedContractMethod<[], [string], "view">;
    getFunction(nameOrSignature: "reactivateWallet"): TypedContractMethod<[wallet: AddressLike], [void], "nonpayable">;
    getFunction(nameOrSignature: "recordRoles"): TypedContractMethod<[
        arg0: BytesLike
    ], [
        [string, boolean] & {
            role: string;
            isActive: boolean;
        }
    ], "view">;
    getFunction(nameOrSignature: "retractTrusteeGrantsOnUnanchor"): TypedContractMethod<[
        subjectIdHash: BytesLike,
        recordIdHash: BytesLike
    ], [
        void
    ], "nonpayable">;
    getFunction(nameOrSignature: "retractVouch"): TypedContractMethod<[voucheeIdHash: BytesLike], [void], "nonpayable">;
    getFunction(nameOrSignature: "revokeRole"): TypedContractMethod<[
        recordIdHash: BytesLike,
        targetWallet: AddressLike
    ], [
        void
    ], "nonpayable">;
    getFunction(nameOrSignature: "revokeRoleBatch"): TypedContractMethod<[
        recordIdHashes: BytesLike[],
        targetWallet: AddressLike
    ], [
        void
    ], "nonpayable">;
    getFunction(nameOrSignature: "revokeTrustee"): TypedContractMethod<[
        trustorIdHash: BytesLike,
        trusteeIdHash: BytesLike
    ], [
        void
    ], "nonpayable">;
    getFunction(nameOrSignature: "roleGrantedBy"): TypedContractMethod<[arg0: BytesLike], [string], "view">;
    getFunction(nameOrSignature: "setHealthRecordCore"): TypedContractMethod<[
        _healthRecordCore: AddressLike
    ], [
        void
    ], "nonpayable">;
    getFunction(nameOrSignature: "setUserStatus"): TypedContractMethod<[
        userIdHash: BytesLike,
        newStatus: BigNumberish
    ], [
        void
    ], "nonpayable">;
    getFunction(nameOrSignature: "sharersByRecord"): TypedContractMethod<[
        arg0: BytesLike,
        arg1: BigNumberish
    ], [
        string
    ], "view">;
    getFunction(nameOrSignature: "totalUsers"): TypedContractMethod<[], [bigint], "view">;
    getFunction(nameOrSignature: "transferAdmin"): TypedContractMethod<[newAdmin: AddressLike], [void], "nonpayable">;
    getFunction(nameOrSignature: "trusteeRelationships"): TypedContractMethod<[
        arg0: BytesLike,
        arg1: BytesLike
    ], [
        [bigint, bigint] & {
            status: bigint;
            level: bigint;
        }
    ], "view">;
    getFunction(nameOrSignature: "trusteesByTrustor"): TypedContractMethod<[
        arg0: BytesLike,
        arg1: BigNumberish
    ], [
        string
    ], "view">;
    getFunction(nameOrSignature: "updateTrusteeLevel"): TypedContractMethod<[
        trusteeIdHash: BytesLike,
        newLevel: BigNumberish
    ], [
        void
    ], "nonpayable">;
    getFunction(nameOrSignature: "upgradeToAndCall"): TypedContractMethod<[
        newImplementation: AddressLike,
        data: BytesLike
    ], [
        void
    ], "payable">;
    getFunction(nameOrSignature: "userStatus"): TypedContractMethod<[arg0: BytesLike], [bigint], "view">;
    getFunction(nameOrSignature: "userWallets"): TypedContractMethod<[
        arg0: BytesLike,
        arg1: BigNumberish
    ], [
        string
    ], "view">;
    getFunction(nameOrSignature: "viewersByRecord"): TypedContractMethod<[
        arg0: BytesLike,
        arg1: BigNumberish
    ], [
        string
    ], "view">;
    getFunction(nameOrSignature: "voluntarilyLeaveOwnership"): TypedContractMethod<[
        recordIdHash: BytesLike,
        newRole: string
    ], [
        void
    ], "nonpayable">;
    getFunction(nameOrSignature: "vouches"): TypedContractMethod<[arg0: BytesLike, arg1: BytesLike], [bigint], "view">;
    getFunction(nameOrSignature: "vouchesGiven"): TypedContractMethod<[
        arg0: BytesLike,
        arg1: BigNumberish
    ], [
        string
    ], "view">;
    getFunction(nameOrSignature: "vouchesReceived"): TypedContractMethod<[
        arg0: BytesLike,
        arg1: BigNumberish
    ], [
        string
    ], "view">;
    getFunction(nameOrSignature: "wallets"): TypedContractMethod<[
        arg0: AddressLike
    ], [
        [string, boolean] & {
            userIdHash: string;
            isWalletActive: boolean;
        }
    ], "view">;
    getEvent(key: "AdminTransferred"): TypedContractEvent<AdminTransferredEvent.InputTuple, AdminTransferredEvent.OutputTuple, AdminTransferredEvent.OutputObject>;
    getEvent(key: "HealthRecordCoreUpdated"): TypedContractEvent<HealthRecordCoreUpdatedEvent.InputTuple, HealthRecordCoreUpdatedEvent.OutputTuple, HealthRecordCoreUpdatedEvent.OutputObject>;
    getEvent(key: "Initialized"): TypedContractEvent<InitializedEvent.InputTuple, InitializedEvent.OutputTuple, InitializedEvent.OutputObject>;
    getEvent(key: "MemberRegistered"): TypedContractEvent<MemberRegisteredEvent.InputTuple, MemberRegisteredEvent.OutputTuple, MemberRegisteredEvent.OutputObject>;
    getEvent(key: "MemberStatusChanged"): TypedContractEvent<MemberStatusChangedEvent.InputTuple, MemberStatusChangedEvent.OutputTuple, MemberStatusChangedEvent.OutputObject>;
    getEvent(key: "OwnershipVoluntarilyLeft"): TypedContractEvent<OwnershipVoluntarilyLeftEvent.InputTuple, OwnershipVoluntarilyLeftEvent.OutputTuple, OwnershipVoluntarilyLeftEvent.OutputObject>;
    getEvent(key: "RoleChanged"): TypedContractEvent<RoleChangedEvent.InputTuple, RoleChangedEvent.OutputTuple, RoleChangedEvent.OutputObject>;
    getEvent(key: "RoleGranted"): TypedContractEvent<RoleGrantedEvent.InputTuple, RoleGrantedEvent.OutputTuple, RoleGrantedEvent.OutputObject>;
    getEvent(key: "RoleRevoked"): TypedContractEvent<RoleRevokedEvent.InputTuple, RoleRevokedEvent.OutputTuple, RoleRevokedEvent.OutputObject>;
    getEvent(key: "TrusteeAccepted"): TypedContractEvent<TrusteeAcceptedEvent.InputTuple, TrusteeAcceptedEvent.OutputTuple, TrusteeAcceptedEvent.OutputObject>;
    getEvent(key: "TrusteeDeclined"): TypedContractEvent<TrusteeDeclinedEvent.InputTuple, TrusteeDeclinedEvent.OutputTuple, TrusteeDeclinedEvent.OutputObject>;
    getEvent(key: "TrusteeLevelUpdated"): TypedContractEvent<TrusteeLevelUpdatedEvent.InputTuple, TrusteeLevelUpdatedEvent.OutputTuple, TrusteeLevelUpdatedEvent.OutputObject>;
    getEvent(key: "TrusteeProposed"): TypedContractEvent<TrusteeProposedEvent.InputTuple, TrusteeProposedEvent.OutputTuple, TrusteeProposedEvent.OutputObject>;
    getEvent(key: "TrusteeRevoked"): TypedContractEvent<TrusteeRevokedEvent.InputTuple, TrusteeRevokedEvent.OutputTuple, TrusteeRevokedEvent.OutputObject>;
    getEvent(key: "Upgraded"): TypedContractEvent<UpgradedEvent.InputTuple, UpgradedEvent.OutputTuple, UpgradedEvent.OutputObject>;
    getEvent(key: "VouchGiven"): TypedContractEvent<VouchGivenEvent.InputTuple, VouchGivenEvent.OutputTuple, VouchGivenEvent.OutputObject>;
    getEvent(key: "VouchRetracted"): TypedContractEvent<VouchRetractedEvent.InputTuple, VouchRetractedEvent.OutputTuple, VouchRetractedEvent.OutputObject>;
    getEvent(key: "WalletLinked"): TypedContractEvent<WalletLinkedEvent.InputTuple, WalletLinkedEvent.OutputTuple, WalletLinkedEvent.OutputObject>;
    filters: {
        "AdminTransferred(address,address,uint256)": TypedContractEvent<AdminTransferredEvent.InputTuple, AdminTransferredEvent.OutputTuple, AdminTransferredEvent.OutputObject>;
        AdminTransferred: TypedContractEvent<AdminTransferredEvent.InputTuple, AdminTransferredEvent.OutputTuple, AdminTransferredEvent.OutputObject>;
        "HealthRecordCoreUpdated(address,uint256)": TypedContractEvent<HealthRecordCoreUpdatedEvent.InputTuple, HealthRecordCoreUpdatedEvent.OutputTuple, HealthRecordCoreUpdatedEvent.OutputObject>;
        HealthRecordCoreUpdated: TypedContractEvent<HealthRecordCoreUpdatedEvent.InputTuple, HealthRecordCoreUpdatedEvent.OutputTuple, HealthRecordCoreUpdatedEvent.OutputObject>;
        "Initialized(uint64)": TypedContractEvent<InitializedEvent.InputTuple, InitializedEvent.OutputTuple, InitializedEvent.OutputObject>;
        Initialized: TypedContractEvent<InitializedEvent.InputTuple, InitializedEvent.OutputTuple, InitializedEvent.OutputObject>;
        "MemberRegistered(address,bytes32,uint256)": TypedContractEvent<MemberRegisteredEvent.InputTuple, MemberRegisteredEvent.OutputTuple, MemberRegisteredEvent.OutputObject>;
        MemberRegistered: TypedContractEvent<MemberRegisteredEvent.InputTuple, MemberRegisteredEvent.OutputTuple, MemberRegisteredEvent.OutputObject>;
        "MemberStatusChanged(bytes32,uint8,uint8,address,uint256)": TypedContractEvent<MemberStatusChangedEvent.InputTuple, MemberStatusChangedEvent.OutputTuple, MemberStatusChangedEvent.OutputObject>;
        MemberStatusChanged: TypedContractEvent<MemberStatusChangedEvent.InputTuple, MemberStatusChangedEvent.OutputTuple, MemberStatusChangedEvent.OutputObject>;
        "OwnershipVoluntarilyLeft(bytes32,bytes32,uint256)": TypedContractEvent<OwnershipVoluntarilyLeftEvent.InputTuple, OwnershipVoluntarilyLeftEvent.OutputTuple, OwnershipVoluntarilyLeftEvent.OutputObject>;
        OwnershipVoluntarilyLeft: TypedContractEvent<OwnershipVoluntarilyLeftEvent.InputTuple, OwnershipVoluntarilyLeftEvent.OutputTuple, OwnershipVoluntarilyLeftEvent.OutputObject>;
        "RoleChanged(bytes32,bytes32,string,string,bytes32,uint256)": TypedContractEvent<RoleChangedEvent.InputTuple, RoleChangedEvent.OutputTuple, RoleChangedEvent.OutputObject>;
        RoleChanged: TypedContractEvent<RoleChangedEvent.InputTuple, RoleChangedEvent.OutputTuple, RoleChangedEvent.OutputObject>;
        "RoleGranted(bytes32,bytes32,string,bytes32,uint256)": TypedContractEvent<RoleGrantedEvent.InputTuple, RoleGrantedEvent.OutputTuple, RoleGrantedEvent.OutputObject>;
        RoleGranted: TypedContractEvent<RoleGrantedEvent.InputTuple, RoleGrantedEvent.OutputTuple, RoleGrantedEvent.OutputObject>;
        "RoleRevoked(bytes32,bytes32,string,bytes32,uint256)": TypedContractEvent<RoleRevokedEvent.InputTuple, RoleRevokedEvent.OutputTuple, RoleRevokedEvent.OutputObject>;
        RoleRevoked: TypedContractEvent<RoleRevokedEvent.InputTuple, RoleRevokedEvent.OutputTuple, RoleRevokedEvent.OutputObject>;
        "TrusteeAccepted(bytes32,bytes32,uint8,uint256)": TypedContractEvent<TrusteeAcceptedEvent.InputTuple, TrusteeAcceptedEvent.OutputTuple, TrusteeAcceptedEvent.OutputObject>;
        TrusteeAccepted: TypedContractEvent<TrusteeAcceptedEvent.InputTuple, TrusteeAcceptedEvent.OutputTuple, TrusteeAcceptedEvent.OutputObject>;
        "TrusteeDeclined(bytes32,bytes32,uint256)": TypedContractEvent<TrusteeDeclinedEvent.InputTuple, TrusteeDeclinedEvent.OutputTuple, TrusteeDeclinedEvent.OutputObject>;
        TrusteeDeclined: TypedContractEvent<TrusteeDeclinedEvent.InputTuple, TrusteeDeclinedEvent.OutputTuple, TrusteeDeclinedEvent.OutputObject>;
        "TrusteeLevelUpdated(bytes32,bytes32,uint8,uint8,uint256)": TypedContractEvent<TrusteeLevelUpdatedEvent.InputTuple, TrusteeLevelUpdatedEvent.OutputTuple, TrusteeLevelUpdatedEvent.OutputObject>;
        TrusteeLevelUpdated: TypedContractEvent<TrusteeLevelUpdatedEvent.InputTuple, TrusteeLevelUpdatedEvent.OutputTuple, TrusteeLevelUpdatedEvent.OutputObject>;
        "TrusteeProposed(bytes32,bytes32,uint8,uint256)": TypedContractEvent<TrusteeProposedEvent.InputTuple, TrusteeProposedEvent.OutputTuple, TrusteeProposedEvent.OutputObject>;
        TrusteeProposed: TypedContractEvent<TrusteeProposedEvent.InputTuple, TrusteeProposedEvent.OutputTuple, TrusteeProposedEvent.OutputObject>;
        "TrusteeRevoked(bytes32,bytes32,bytes32,uint256)": TypedContractEvent<TrusteeRevokedEvent.InputTuple, TrusteeRevokedEvent.OutputTuple, TrusteeRevokedEvent.OutputObject>;
        TrusteeRevoked: TypedContractEvent<TrusteeRevokedEvent.InputTuple, TrusteeRevokedEvent.OutputTuple, TrusteeRevokedEvent.OutputObject>;
        "Upgraded(address)": TypedContractEvent<UpgradedEvent.InputTuple, UpgradedEvent.OutputTuple, UpgradedEvent.OutputObject>;
        Upgraded: TypedContractEvent<UpgradedEvent.InputTuple, UpgradedEvent.OutputTuple, UpgradedEvent.OutputObject>;
        "VouchGiven(bytes32,bytes32,uint256)": TypedContractEvent<VouchGivenEvent.InputTuple, VouchGivenEvent.OutputTuple, VouchGivenEvent.OutputObject>;
        VouchGiven: TypedContractEvent<VouchGivenEvent.InputTuple, VouchGivenEvent.OutputTuple, VouchGivenEvent.OutputObject>;
        "VouchRetracted(bytes32,bytes32,uint256)": TypedContractEvent<VouchRetractedEvent.InputTuple, VouchRetractedEvent.OutputTuple, VouchRetractedEvent.OutputObject>;
        VouchRetracted: TypedContractEvent<VouchRetractedEvent.InputTuple, VouchRetractedEvent.OutputTuple, VouchRetractedEvent.OutputObject>;
        "WalletLinked(address,bytes32,uint256)": TypedContractEvent<WalletLinkedEvent.InputTuple, WalletLinkedEvent.OutputTuple, WalletLinkedEvent.OutputObject>;
        WalletLinked: TypedContractEvent<WalletLinkedEvent.InputTuple, WalletLinkedEvent.OutputTuple, WalletLinkedEvent.OutputObject>;
    };
}
//# sourceMappingURL=MemberRoleManager.d.ts.map