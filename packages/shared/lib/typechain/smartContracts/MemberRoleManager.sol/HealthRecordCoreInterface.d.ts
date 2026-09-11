import type { BaseContract, BytesLike, FunctionFragment, Result, Interface, ContractRunner, ContractMethod, Listener } from "ethers";
import type { TypedContractEvent, TypedDeferredTopicFilter, TypedEventLog, TypedListener, TypedContractMethod } from "../../common";
export interface HealthRecordCoreInterfaceInterface extends Interface {
    getFunction(nameOrSignature: "isActiveSubject"): FunctionFragment;
    encodeFunctionData(functionFragment: "isActiveSubject", values: [BytesLike, BytesLike]): string;
    decodeFunctionResult(functionFragment: "isActiveSubject", data: BytesLike): Result;
}
export interface HealthRecordCoreInterface extends BaseContract {
    connect(runner?: ContractRunner | null): HealthRecordCoreInterface;
    waitForDeployment(): Promise<this>;
    interface: HealthRecordCoreInterfaceInterface;
    queryFilter<TCEvent extends TypedContractEvent>(event: TCEvent, fromBlockOrBlockhash?: string | number | undefined, toBlock?: string | number | undefined): Promise<Array<TypedEventLog<TCEvent>>>;
    queryFilter<TCEvent extends TypedContractEvent>(filter: TypedDeferredTopicFilter<TCEvent>, fromBlockOrBlockhash?: string | number | undefined, toBlock?: string | number | undefined): Promise<Array<TypedEventLog<TCEvent>>>;
    on<TCEvent extends TypedContractEvent>(event: TCEvent, listener: TypedListener<TCEvent>): Promise<this>;
    on<TCEvent extends TypedContractEvent>(filter: TypedDeferredTopicFilter<TCEvent>, listener: TypedListener<TCEvent>): Promise<this>;
    once<TCEvent extends TypedContractEvent>(event: TCEvent, listener: TypedListener<TCEvent>): Promise<this>;
    once<TCEvent extends TypedContractEvent>(filter: TypedDeferredTopicFilter<TCEvent>, listener: TypedListener<TCEvent>): Promise<this>;
    listeners<TCEvent extends TypedContractEvent>(event: TCEvent): Promise<Array<TypedListener<TCEvent>>>;
    listeners(eventName?: string): Promise<Array<Listener>>;
    removeAllListeners<TCEvent extends TypedContractEvent>(event?: TCEvent): Promise<this>;
    isActiveSubject: TypedContractMethod<[
        recordIdHash: BytesLike,
        userIdHash: BytesLike
    ], [
        boolean
    ], "view">;
    getFunction<T extends ContractMethod = ContractMethod>(key: string | FunctionFragment): T;
    getFunction(nameOrSignature: "isActiveSubject"): TypedContractMethod<[
        recordIdHash: BytesLike,
        userIdHash: BytesLike
    ], [
        boolean
    ], "view">;
    filters: {};
}
//# sourceMappingURL=HealthRecordCoreInterface.d.ts.map