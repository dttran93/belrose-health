import { type ContractRunner } from "ethers";
import type { HealthRecordCoreInterface, HealthRecordCoreInterfaceInterface } from "../../../smartContracts/MemberRoleManager.sol/HealthRecordCoreInterface";
export declare class HealthRecordCoreInterface__factory {
    static readonly abi: readonly [{
        readonly inputs: readonly [{
            readonly internalType: "bytes32";
            readonly name: "recordIdHash";
            readonly type: "bytes32";
        }, {
            readonly internalType: "bytes32";
            readonly name: "userIdHash";
            readonly type: "bytes32";
        }];
        readonly name: "isActiveSubject";
        readonly outputs: readonly [{
            readonly internalType: "bool";
            readonly name: "";
            readonly type: "bool";
        }];
        readonly stateMutability: "view";
        readonly type: "function";
    }];
    static createInterface(): HealthRecordCoreInterfaceInterface;
    static connect(address: string, runner?: ContractRunner | null): HealthRecordCoreInterface;
}
//# sourceMappingURL=HealthRecordCoreInterface__factory.d.ts.map