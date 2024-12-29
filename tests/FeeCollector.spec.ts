import { Blockchain, SandboxContract, TreasuryContract, RemoteBlockchainStorage, wrapTonClient4ForRemote } from '@ton/sandbox';
import { Address, beginCell, Cell, toNano } from '@ton/core';
import { FeeCollector, swapPayload } from '../wrappers/FeeCollector';
import { compile } from '@ton/blueprint';

import { TonClient4 } from '@ton/ton';
import { Factory, MAINNET_FACTORY_ADDR, VaultJetton, VaultNative, Vault, Asset, PoolType, ReadinessStatus, JettonRoot, JettonWallet, Pool } from '@dedust/sdk';

import '@ton/test-utils';

async function findPair(blockchain: Blockchain, jettonAddress: Address) {
    const factory = blockchain.openContract(Factory.createFromAddress(MAINNET_FACTORY_ADDR));

    const jetton = Asset.jetton(jettonAddress);
    const poolAddress = await factory.getPool(PoolType.VOLATILE, [Asset.native(), jetton]);
    const pool = blockchain.openContract(poolAddress);

    if ((await pool.getReadinessStatus()) !== ReadinessStatus.READY) {
        throw new Error(`Pool does not exist.`);
    }

    return pool;
}

describe('FeeCollector', () => {
    let code: Cell;

    beforeAll(async () => {
        code = await compile('FeeCollector');
    });

    const MIN_BALANCE = toNano('0.1');

    const DEFAULT_DEDUST_GAS_AMOUNT = toNano('0.25');
    const DEFAULT_SELL_DEDUST_GAS_AMOUNT = toNano('0.3');

    let blockchain: Blockchain;
    let deployer: SandboxContract<TreasuryContract>;
    let fakeDeployer: SandboxContract<TreasuryContract>;

    let feeCollector: SandboxContract<FeeCollector>;

    // jettons contracts
    let jettonRoot: SandboxContract<JettonRoot>;
    let jettonWallet: SandboxContract<JettonWallet>;
    let feeCollectorJettonWallet: SandboxContract<JettonWallet>;
    let fakeDeployerJettonWallet: SandboxContract<JettonWallet>;

    // dedust contracts
    let factory: SandboxContract<Factory>;
    let pool: SandboxContract<Pool>;
    let tonVault: SandboxContract<VaultNative>;
    let jettonVault: SandboxContract<VaultJetton>;

    beforeEach(async () => {
        blockchain = await Blockchain.create({
            storage: new RemoteBlockchainStorage(wrapTonClient4ForRemote(new TonClient4({
                endpoint: 'https://mainnet-v4.tonhubapi.com',
            })))
        });

        deployer = await blockchain.treasury('deployer');
        fakeDeployer = await blockchain.treasury('fakeDeployer');

        feeCollector = await blockchain.openContract(FeeCollector.createFromConfig({ operatorAddress: deployer.getSender().address }, code));

        const deployResult = await feeCollector.sendDeploy(deployer.getSender(), toNano('0.05'));

        expect(deployResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: feeCollector.address,
            deploy: true,
            success: true,
        });

        jettonRoot = await blockchain.openContract(JettonRoot.createFromAddress(Address.parse("EQBlqsm144Dq6SjbPI4jjZvA1hqTIP3CvHovbIfW_t-SCALE")));

        let jettonWalletAddress = await jettonRoot.getWalletAddress(deployer.getSender().address);
        jettonWallet = await blockchain.openContract(JettonWallet.createFromAddress(jettonWalletAddress));

        let fakeDeployerJettonWalletAddress = await jettonRoot.getWalletAddress(fakeDeployer.address);
        fakeDeployerJettonWallet = await blockchain.openContract(JettonWallet.createFromAddress(fakeDeployerJettonWalletAddress));

        let feeCollectorJettonWalletAddress = await jettonRoot.getWalletAddress(feeCollector.address);
        feeCollectorJettonWallet = await blockchain.openContract(JettonWallet.createFromAddress(feeCollectorJettonWalletAddress));

        factory = await blockchain.openContract(Factory.createFromAddress(MAINNET_FACTORY_ADDR));
        pool = await findPair(blockchain, jettonRoot.address);
        tonVault = await blockchain.openContract(await factory.getNativeVault());
    });

    it('check operator address', async () => {
        const operatorAddress = await feeCollector.getOperatorAddress();

        expect(operatorAddress.toRawString()).toEqual(deployer.getSender().address.toRawString());
    });

    it('receive jetton and then TON fees', async () => {
        const buy = await tonVault.sendSwap(deployer.getSender(), {
            poolAddress: pool.address,
            amount: toNano('100'),
            gasAmount: DEFAULT_DEDUST_GAS_AMOUNT,
            swapParams: {
                recipientAddress: feeCollector.address,
                fulfillPayload: swapPayload({
                    recipientAddress: deployer.getSender().address,
                    taxBPS: 100, // 100 / 10000 = 1%
                }),
            }
        });

        expect(buy.transactions).toHaveTransaction({
            to: feeCollector.address,
            success: true
        });

        expect(buy.transactions).toHaveTransaction({
            from: feeCollector.address,
            to: feeCollectorJettonWallet.address,
            success: true
        });

        // receive TON

        const jettonWalletBalance = await jettonWallet.getBalance();

        if (jettonWalletBalance === 0n) {
            throw new Error('Not enough jettons in the wallet');
        }

        jettonVault = await blockchain.openContract(await factory.getJettonVault(jettonRoot.address));

        const sell = await jettonWallet.sendTransfer(deployer.getSender(), DEFAULT_SELL_DEDUST_GAS_AMOUNT, {
            amount: jettonWalletBalance,
            destination: jettonVault.address,
            responseAddress: deployer.getSender().address,
            forwardAmount: DEFAULT_DEDUST_GAS_AMOUNT,
            forwardPayload: VaultJetton.createSwapPayload({
                poolAddress: pool.address,
                limit: 0n,
                swapParams: {
                    recipientAddress: feeCollector.address,
                    fulfillPayload: swapPayload({
                        recipientAddress: deployer.getSender().address, // would not send TON to receiver_addr if recipient_addr set to feeCollector
                        taxBPS: 100, // 100 / 10000 = 1%
                    }),
                }
            })
        });

        expect(sell.transactions).toHaveTransaction({
            to: feeCollector.address,
            success: true
        });

        expect(sell.transactions).toHaveTransaction({
            from: feeCollector.address,
            to: deployer.getSender().address,
            success: true
        });

        // claiming jettons

        let feeCollectorJettonBalanceBefore = await feeCollectorJettonWallet.getBalance();

        await feeCollector.sendJettonWithdraw(fakeDeployer.getSender(), {
            walletAddress: fakeDeployerJettonWallet.address,
            recipientAddress: fakeDeployer.getSender().address,
            amount: feeCollectorJettonBalanceBefore.toString(),
        });

        let feeCollectorJettonBalanceAfter = await feeCollectorJettonWallet.getBalance();

        expect(feeCollectorJettonBalanceAfter).toEqual(feeCollectorJettonBalanceBefore);

        const jettonWithdrawTxs = await feeCollector.sendJettonWithdraw(deployer.getSender(), {
            walletAddress: feeCollectorJettonWallet.address,
            recipientAddress: deployer.getSender().address,
            amount: feeCollectorJettonBalanceBefore.toString(),
        });

        expect(jettonWithdrawTxs.transactions).toHaveTransaction({
            from: feeCollector.address,
            to: feeCollectorJettonWallet.address,
            success: true
        });
    });

    it('claiming TON', async () => {
        // fake operator test
        await fakeDeployer.send({
            to: feeCollector.address,
            value: toNano('10'),
            bounce: false
        });

        let fakeDeployerBalanceBefore = await fakeDeployer.getBalance();

        await feeCollector.sendTonWithdraw(fakeDeployer.getSender(), {
            recipientAddress: fakeDeployer.getSender().address
        });

        let fakeDeployerBalanceAfter = await fakeDeployer.getBalance();

        expect(fakeDeployerBalanceAfter).toBeLessThan(fakeDeployerBalanceBefore);

        // valid operator test

        await deployer.send({
            to: feeCollector.address,
            value: toNano('10'),
            bounce: false
        });

        let deployerBalanceBefore = await deployer.getBalance();

        await feeCollector.sendTonWithdraw(deployer.getSender(), {
            recipientAddress: deployer.getSender().address
        });

        let deployerBalanceAfter = await deployer.getBalance();

        expect(deployerBalanceAfter).toBeGreaterThan(deployerBalanceBefore - toNano("0.1"));

        // fee collector balance test

        let feeCollectorBalance = await feeCollector.getBalance();

        expect(feeCollectorBalance).toEqual(MIN_BALANCE);
    });
});
