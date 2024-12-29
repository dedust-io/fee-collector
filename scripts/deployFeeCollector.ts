import { toNano } from '@ton/core';
import { FeeCollector } from '../wrappers/FeeCollector';
import { compile, NetworkProvider } from '@ton/blueprint';

export async function run(provider: NetworkProvider) {
    const feeCollector = provider.open(FeeCollector.createFromConfig({ operatorAddress: provider.sender().address! }, await compile('FeeCollector')));

    await feeCollector.sendDeploy(provider.sender(), toNano('0.05'));

    await provider.waitForDeploy(feeCollector.address);
}
