import { Field, h, Section, type ConfiguratorUISpec } from '@gadgets/configurator-ui';
import type { SalesConfiguratorRpc, SalesConfiguratorValues } from './sales-configurator-types';

export default {
  initial: { confirmed: 'yes' },
  isReady() { return true; },
  resourceUrl({ ui }) { return ui.resourceUrl(); },
  render() {
    return <Section><Field label="営業デモ" description="この端末のダミーデータを接続します。外部送信や実データの転送はありません。" /></Section>;
  },
} satisfies ConfiguratorUISpec<SalesConfiguratorRpc, SalesConfiguratorValues>;
