import { Address, beginCell, Cell, Contract, contractAddress, ContractProvider, Sender, SendMode, toNano } from '@ton/core';
import { SendMessageResult } from '@ton/sandbox';

export type FeeCollectorConfig = {
    operatorAddress: Address;
};

export function feeCollectorConfigToCell(config: FeeCollectorConfig): Cell {
    return beginCell()
        .storeAddress(config.operatorAddress)
        .endCell();
}

export const Opcodes = {
    claimJetton: 0x76cbb3e,
    claimTon: 0x64a6018c,
};

export function swapPayload(opts: {
    recipientAddress: Address;
    taxBPS: number;
}) {
    return beginCell()
        .storeAddress(opts.recipientAddress)
        .storeUint(opts.taxBPS, 16)
        .endCell();
}

export class FeeCollector implements Contract {
    constructor(readonly address: Address, readonly init?: { code: Cell; data: Cell }) { }

    static createFromAddress(address: Address) {
        return new FeeCollector(address);
    }

    static createFromConfig(config: FeeCollectorConfig, code: Cell, workchain = 0) {
        const data = feeCollectorConfigToCell(config);
        const init = { code, data };
        return new FeeCollector(contractAddress(workchain, init), init);
    }

    async sendDeploy(provider: ContractProvider, via: Sender, value: bigint) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell().endCell(),
        });
    }

    async sendJettonWithdraw(provider: ContractProvider, via: Sender, opts: {
        queryId?: number;
        walletAddress: Address;
        recipientAddress: Address;
        amount: string;
    }) {
        await provider.internal(via, {
            value: toNano('0.1'),
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                .storeUint(Opcodes.claimJetton, 32)
                .storeUint(opts.queryId ?? 0, 64)
                .storeAddress(opts.walletAddress) // jetton wallet
                .storeAddress(opts.recipientAddress) // recipient
                .storeCoins(BigInt(opts.amount)) // jetton amount
                .endCell(),
        });
    }

    async sendTonWithdraw(
        provider: ContractProvider,
        via: Sender,
        opts: {
            recipientAddress: Address;
            queryId?: number;
            payload?: Cell;
        }) {
        await provider.internal(via, {
            value: toNano('0.1'),
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                .storeUint(Opcodes.claimTon, 32)
                .storeUint(opts.queryId ?? 0, 64)
                .storeAddress(opts.recipientAddress) // recipient
                .storeMaybeRef(opts.payload ?? beginCell().endCell()) // payload
                .endCell(),
        });
    }

    async getOperatorAddress(provider: ContractProvider) {
        const result = await provider.get('operatorAddress', []);
        return result.stack.readAddress();
    }

    async getBalance(provider: ContractProvider) {
        return (await provider.getState()).balance;
    }
}
