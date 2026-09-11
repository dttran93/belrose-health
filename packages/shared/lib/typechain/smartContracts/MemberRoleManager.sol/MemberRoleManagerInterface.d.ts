import type { BaseContract, BytesLike, FunctionFragment, Result, Interface, AddressLike, ContractRunner, ContractMethod, Listener } from "ethers";
import type { TypedContractEvent, TypedDeferredTopicFilter, TypedEventLog, TypedListener, TypedContractMethod } from "../../common";
export interface MemberRoleManagerInterfaceInterface extends Interface {
    getFunction(nameOrSignature: "getUserForWallet" | "hasActiveRole" | "hasRole" | "isActiveMember" | "isControllerOf" | "isOwnerOrAdmin" | "isVerifiedMember" | "isVerifiedProvider"): FunctionFragment;
    encodeFunctionData(functionFragment: "getUserForWallet", values: [AddressLike]): string;
    encodeFunctionData(functionFragment: "hasActiveRole", values: [BytesLike, AddressLike]): string;
    encodeFunctionData(functionFragment: "hasRole", values: [BytesLike, AddressLike, string]): string;
    encodeFunctionData(functionFragment: "isActiveMember", values: [AddressLike]): string;
    encodeFunctionData(functionFragment: "isControllerOf", values: [BytesLike, BytesLike]): string;
    encodeFunctionData(functionFragment: "isOwnerOrAdmin", values: [BytesLike, AddressLike]): string;
    encodeFunctionData(functionFragment: "isVerifiedMember", values: [AddressLike]): string;
    encodeFunctionData(functionFragment: "isVerifiedProvider", values: [AddressLike]): string;
    decodeFunctionResult(functionFragment: "getUserForWallet", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "hasActiveRole", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "hasRole", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "isActiveMember", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "isControllerOf", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "isOwnerOrAdmin", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "isVerifiedMember", data: BytesLike): Result;
    decodeFunctionResult(functionFragment: "isVerifiedProvider", data: BytesLike): Result;
}
export interface MemberRoleManagerInterface extends BaseContract {
    connect(runner?: ContractRunner | null): MemberRoleManagerInterface;
    waitForDeployment(): Promise<this>;
    interface: MemberRoleManagerInterfaceInterface;
    queryFilter<TCEvent extends TypedContractEvent>(event: TCEvent, fromBlockOrBlockhash?: string | number | undefined, toBlock?: string | number | undefined): Promise<Array<TypedEventLog<TCEvent>>>;
    queryFilter<TCEvent extends TypedContractEvent>(filter: TypedDeferredTopicFilter<TCEvent>, fromBlockOrBlockhash?: string | number | undefined, toBlock?: string | number | undefined): Promise<Array<TypedEventLog<TCEvent>>>;
    on<TCEvent extends TypedContractEvent>(event: TCEvent, listener: TypedListener<TCEvent>): Promise<this>;
    on<TCEvent extends TypedContractEvent>(filter: TypedDeferredTopicFilter<TCEvent>, listener: TypedListener<TCEvent>): Promise<this>;
    once<TCEvent extends TypedContractEvent>(event: TCEvent, listener: TypedListener<TCEvent>): Promise<this>;
    once<TCEvent extends TypedContractEvent>(filter: TypedDeferredTopicFilter<TCEvent>, listener: TypedListener<TCEvent>): Promise<this>;
    listeners<TCEvent extends TypedContractEvent>(event: TCEvent): Promise<Array<TypedListener<TCEvent>>>;
    listeners(eventName?: string): Promise<Array<Listener>>;
    removeAllListeners<TCEvent extends TypedContractEvent>(event?: TCEvent): Promise<this>;
    getUserForWallet: TypedContractMethod<[
        wallet: AddressLike
    ], [
        string
    ], "view">;
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
    isActiveMember: TypedContractMethod<[wallet: AddressLike], [boolean], "view">;
    isControllerOf: TypedContractMethod<[
        trustorIdHash: BytesLike,
        controllerIdHash: BytesLike
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
    getFunction<T extends ContractMethod = ContractMethod>(key: string | FunctionFragment): T;
    getFunction(nameOrSignature: "getUserForWallet"): TypedContractMethod<[wallet: AddressLike], [string], "view">;
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
    getFunction(nameOrSignature: "isActiveMember"): TypedContractMethod<[wallet: AddressLike], [boolean], "view">;
    getFunction(nameOrSignature: "isControllerOf"): TypedContractMethod<[
        trustorIdHash: BytesLike,
        controllerIdHash: BytesLike
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
    filters: {};
}
//# sourceMappingURL=MemberRoleManagerInterface.d.ts.map