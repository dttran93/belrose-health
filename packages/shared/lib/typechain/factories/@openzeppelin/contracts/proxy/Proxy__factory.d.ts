import { type ContractRunner } from "ethers";
import type { Proxy, ProxyInterface } from "../../../../@openzeppelin/contracts/proxy/Proxy";
export declare class Proxy__factory {
    static readonly abi: readonly [{
        readonly stateMutability: "payable";
        readonly type: "fallback";
    }];
    static createInterface(): ProxyInterface;
    static connect(address: string, runner?: ContractRunner | null): Proxy;
}
//# sourceMappingURL=Proxy__factory.d.ts.map