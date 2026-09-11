import { type ContractRunner } from "ethers";
import type { MemberRoleManagerInterface, MemberRoleManagerInterfaceInterface } from "../../../smartContracts/MemberRoleManager.sol/MemberRoleManagerInterface";
export declare class MemberRoleManagerInterface__factory {
    static readonly abi: readonly [{
        readonly inputs: readonly [{
            readonly internalType: "address";
            readonly name: "wallet";
            readonly type: "address";
        }];
        readonly name: "getUserForWallet";
        readonly outputs: readonly [{
            readonly internalType: "bytes32";
            readonly name: "";
            readonly type: "bytes32";
        }];
        readonly stateMutability: "view";
        readonly type: "function";
    }, {
        readonly inputs: readonly [{
            readonly internalType: "bytes32";
            readonly name: "recordIdHash";
            readonly type: "bytes32";
        }, {
            readonly internalType: "address";
            readonly name: "wallet";
            readonly type: "address";
        }];
        readonly name: "hasActiveRole";
        readonly outputs: readonly [{
            readonly internalType: "bool";
            readonly name: "";
            readonly type: "bool";
        }];
        readonly stateMutability: "view";
        readonly type: "function";
    }, {
        readonly inputs: readonly [{
            readonly internalType: "bytes32";
            readonly name: "recordIdHash";
            readonly type: "bytes32";
        }, {
            readonly internalType: "address";
            readonly name: "wallet";
            readonly type: "address";
        }, {
            readonly internalType: "string";
            readonly name: "role";
            readonly type: "string";
        }];
        readonly name: "hasRole";
        readonly outputs: readonly [{
            readonly internalType: "bool";
            readonly name: "";
            readonly type: "bool";
        }];
        readonly stateMutability: "view";
        readonly type: "function";
    }, {
        readonly inputs: readonly [{
            readonly internalType: "address";
            readonly name: "wallet";
            readonly type: "address";
        }];
        readonly name: "isActiveMember";
        readonly outputs: readonly [{
            readonly internalType: "bool";
            readonly name: "";
            readonly type: "bool";
        }];
        readonly stateMutability: "view";
        readonly type: "function";
    }, {
        readonly inputs: readonly [{
            readonly internalType: "bytes32";
            readonly name: "trustorIdHash";
            readonly type: "bytes32";
        }, {
            readonly internalType: "bytes32";
            readonly name: "controllerIdHash";
            readonly type: "bytes32";
        }];
        readonly name: "isControllerOf";
        readonly outputs: readonly [{
            readonly internalType: "bool";
            readonly name: "";
            readonly type: "bool";
        }];
        readonly stateMutability: "view";
        readonly type: "function";
    }, {
        readonly inputs: readonly [{
            readonly internalType: "bytes32";
            readonly name: "recordIdHash";
            readonly type: "bytes32";
        }, {
            readonly internalType: "address";
            readonly name: "wallet";
            readonly type: "address";
        }];
        readonly name: "isOwnerOrAdmin";
        readonly outputs: readonly [{
            readonly internalType: "bool";
            readonly name: "";
            readonly type: "bool";
        }];
        readonly stateMutability: "view";
        readonly type: "function";
    }, {
        readonly inputs: readonly [{
            readonly internalType: "address";
            readonly name: "wallet";
            readonly type: "address";
        }];
        readonly name: "isVerifiedMember";
        readonly outputs: readonly [{
            readonly internalType: "bool";
            readonly name: "";
            readonly type: "bool";
        }];
        readonly stateMutability: "view";
        readonly type: "function";
    }, {
        readonly inputs: readonly [{
            readonly internalType: "address";
            readonly name: "wallet";
            readonly type: "address";
        }];
        readonly name: "isVerifiedProvider";
        readonly outputs: readonly [{
            readonly internalType: "bool";
            readonly name: "";
            readonly type: "bool";
        }];
        readonly stateMutability: "view";
        readonly type: "function";
    }];
    static createInterface(): MemberRoleManagerInterfaceInterface;
    static connect(address: string, runner?: ContractRunner | null): MemberRoleManagerInterface;
}
//# sourceMappingURL=MemberRoleManagerInterface__factory.d.ts.map