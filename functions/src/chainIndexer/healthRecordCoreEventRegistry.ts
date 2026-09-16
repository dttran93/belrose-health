// functions/src/chainIndexer/healthRecordCoreEventRegistry.ts
//
// Per-event-type dispatch table for HealthRecordCore.sol — mirrors
// memberRoleManagerEventRegistry.ts's exact shape/conventions for the second contract this
// indexer covers. See that file's own header for the general registry pattern.
//
// HRC Slice 1 covers AdminTransferred only. See healthRecordCoreEventDecoders.ts's header for
// what's deliberately out of scope (setMemberRoleManager emits no event; UUPS's inherited
// Upgraded event isn't a custom declared event either).

import type { HealthRecordCore } from '../_shared/typechain';
import { HealthRecordCore__factory } from '../_shared/typechain';
import { HEALTH_RECORD_CORE } from '../_shared';
import type { ChainEventRegistryEntry, ChainIndexerContractConfig } from './chainIndexerContractConfig';
import {
  decodeHealthRecordCoreAdminTransferredEventLog,
  type HealthRecordCoreEventName,
  type RawHealthRecordCoreAdminTransferredEventLog,
} from './healthRecordCoreEventDecoders';
import { reconcileHealthRecordCoreAdminTransferredEvent } from './healthRecordCoreReconciliationService';

export const HEALTH_RECORD_CORE_EVENT_REGISTRY: Record<
  HealthRecordCoreEventName,
  ChainEventRegistryEntry<HealthRecordCore>
> = {
  AdminTransferred: {
    getFilter: contract => contract.filters.AdminTransferred(),
    toRawArgs: log => ({
      oldAdmin: log.args.oldAdmin as string,
      newAdmin: log.args.newAdmin as string,
    }),
    decode: log => decodeHealthRecordCoreAdminTransferredEventLog(log as RawHealthRecordCoreAdminTransferredEventLog),
    reconcile: reconcileHealthRecordCoreAdminTransferredEvent,
  },
};

/** Everything chainEventIndexerService.ts's generic loop needs to run a full cycle against
 *  HealthRecordCore — see chainIndexerContractConfig.ts's own doc comment for why this shape
 *  exists (multi-contract support). */
export const HEALTH_RECORD_CORE_INDEXER_CONFIG: ChainIndexerContractConfig<
  HealthRecordCore,
  HealthRecordCoreEventName
> = {
  contract: 'HealthRecordCore',
  connect: HealthRecordCore__factory.connect,
  proxyAddress: HEALTH_RECORD_CORE.proxy,
  deploymentBlock: HEALTH_RECORD_CORE.deploymentBlock,
  registry: HEALTH_RECORD_CORE_EVENT_REGISTRY,
};
