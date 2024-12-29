import { FeeCollector } from '../wrappers/FeeCollector';
import { NetworkProvider } from '@ton/blueprint';

export async function run(provider: NetworkProvider) {
    const ui = provider.ui();

    const feeCollector = provider.open(FeeCollector.createFromAddress(await ui.inputAddress('Enter FeeCollector address: ')));

    if (!(await provider.isContractDeployed(feeCollector.address))) {
        ui.write('FeeCollector is not deployed');
        return;
    }

    await feeCollector.sendTonWithdraw(provider.sender(), {
        recipientAddress: await ui.inputAddress('Enter recipient address: '),
    });

    ui.write('TON Claimed');
}
