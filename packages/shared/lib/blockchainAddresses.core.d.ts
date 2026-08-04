export declare const NETWORK_CORE: {
    readonly chainId: 84532;
    readonly name: "base-sepolia";
    readonly rpcUrlFallback: "https://base-sepolia-rpc.publicnode.com";
    readonly explorerUrl: "https://sepolia.basescan.org/";
};
export declare function buildRpcUrl(apiKey: string): string;
export declare const AA_INFRASTRUCTURE: {
    readonly entryPoint: "0x0000000071727De22E5E9d8BAf0edAc6f37da032";
};
export declare const PAYMASTER: {
    readonly address: "0x02422f03EcD403E1a902101D60a0Dad5bB9E71a7";
    readonly dailySponsorLimit: 100;
};
export declare function buildBundlerURL(pimlicoApiKey: string): string;
export declare const MEMBER_ROLE_MANAGER: {
    readonly proxy: "0x61CcF57C332D32c4d906ac64674BBA4E10CCB07B";
    readonly implementation: "0x88a7a3822c8033ae126c762a40c280e89024a1ac";
    readonly deploymentBlock: 43657997;
};
export declare const HEALTH_RECORD_CORE: {
    readonly proxy: "0xE1012A0D698cced489C47189F9DC9372d6Fb104B";
    readonly implementation: "0x4f6C255F4B433692364e424e2BDeC78ADe7c10fd";
    readonly deploymentBlock: 43657997;
};
export declare const CONTRACT_ADDRESSES: {
    readonly paymaster: "0x02422f03EcD403E1a902101D60a0Dad5bB9E71a7";
    readonly memberRoleManager: "0x61CcF57C332D32c4d906ac64674BBA4E10CCB07B";
    readonly healthRecordCore: "0xE1012A0D698cced489C47189F9DC9372d6Fb104B";
    readonly entryPoint: "0x0000000071727De22E5E9d8BAf0edAc6f37da032";
};
export interface BlockchainRef {
    txHash: string;
    chainId: number;
    blockNumber: number;
    contractAddress: string;
}
export declare function buildBlockchainRef(txHash: string, blockNumber: number, contractAddress: string): BlockchainRef;
export declare const buildMemberRegistryRef: (txHash: string, blockNumber: number) => BlockchainRef;
export declare const buildHealthRecordRef: (txHash: string, blockNumber: number) => BlockchainRef;
//# sourceMappingURL=blockchainAddresses.core.d.ts.map