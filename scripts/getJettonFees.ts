import { FeeCollector } from '../wrappers/FeeCollector';
import { NetworkProvider } from '@ton/blueprint';
import { JettonRoot } from '@dedust/sdk';

export async function run(provider: NetworkProvider) {
    const ui = provider.ui();

    const feeCollector = provider.open(FeeCollector.createFromAddress(await ui.inputAddress('Enter FeeCollector address: ')));

    const jettonRoot = provider.open(JettonRoot.createFromAddress(await ui.inputAddress('Enter jetton master address: ')));
    const jettonWallet = provider.open(await jettonRoot.getWallet(feeCollector.address));

    if (!(await provider.isContractDeployed(feeCollector.address))) {
        ui.write('FeeCollector is not deployed');
        return;
    }

    const jettonAmount = await jettonWallet.getBalance();

    if (jettonAmount === 0n){
        ui.write('No jetton to claim');
        return;
    }

    await feeCollector.sendJettonWithdraw(provider.sender(), {
        walletAddress: jettonWallet.address,
        recipientAddress: await ui.inputAddress('Enter recipient address: '),
        amount: jettonAmount.toString(),
    });

    ui.write('TON Claimed');
}
