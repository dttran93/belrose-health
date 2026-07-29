// e2e/helpers/fixtures/recipient.ts
//
// A second real, pre-existing account — reused across e2e runs as the recipient side of
// recordSharingAndPermissions.spec.ts (FIXTURE_GUARDIAN is the fixture record's owner; this is
// who the record gets shared *to*). Same recipe as guardian.ts, and the same constraints apply:
// this can't be hand-generated, only captured from a real registration run.

import type { FixtureUser } from './types';

export const FIXTURE_RECIPIENT: FixtureUser = {
  uid: '2Pn09fjP40M6JKzjaNXBDPMQUZl2',
  email: 'belrose.test+1@gmail.com',
  password: 'pleasebeourGuest1!',
  displayName: 'Dr. Stephen Strange',

  doc: {
    uid: '2Pn09fjP40M6JKzjaNXBDPMQUZl2',
    email: 'belrose.test+1@gmail.com',
    emailVerified: true,
    emailVerifiedAt: new Date('2026-03-24T12:48:07.000Z'),
    displayName: 'Dr. Stephen Strange',
    displayNameLower: 'dr. stephen strange',
    firstName: 'Dr. Stephen',
    lastName: 'Strange',
    identityVerified: false,
    createdAt: new Date('2026-03-13T10:58:35.000Z'),
    updatedAt: new Date('2026-06-25T18:44:45.000Z'),

    encryption: {
      enabled: true,
      encryptedMasterKey: 'i0E6wibHw9pXnfiPrd3Hjy0ZWg2k37qb+jTykra4UUaZ2CeOcHYSq2kM+UX8JY5n',
      masterKeyIV: 'qJtXM/s/LrmikxY0',
      masterKeySalt: '2oj3z9Zu8x/I3s4C3zPOog==',
      encryptedPrivateKey:
        'CtTcG2c5rNjaX6s1uBOHhln46Z5ps7UFL752JpzI5uHZk29n/RS72IaQWKqfiP0u++Dbe3ONeawF3t5Ev552yRL6AZsTbdr7lfK027uM/BihiTsl8wftSrAw5RlKwgtTGrsgs0b6DrPwRsIJ5nnowndER6q/8H1Cbx8ReHfnVijHsgx3A7uYRM0YLLi+8i8NZnQ/5FUBaWQSXezlKOUoJpAwi7OUymUWUFbDwHoJ0NXOayj1v1W2zZnM3oopYxsMmhEfrtlUWsx18Eu/h5GNEnU+hDq0aG4Sx8/irgMvDdAZimUjcVMw+m1b+X2gZgycGtOkDex+EShI7EJL87Xhl/hBoXsxVxt9oV9Oy31H8wyfdMton8JQcwcw7584ePzCJMF6fC5cYBLF5o4/lHityZkgXgl5LEz4JW/OlLZHpK91cSnO7kzgPUaR82r+ohDtM6i9BH3ie9/Wk+XBgTAv25ZZsAPKB3qbAXCrhrU8c2H9UYL+AWZty9CMKEGPXbuZGIiqra+CKU25j1XX3iathcJdCsP+BFxeq/W2ZmWuPzaCtuIfAWYr9kK36soxMi3u2hRFlvKD77K1gc6fwrz9NjBulQNT56uuMXbPUwltgh0rvkC3IgZIsZM71YoVzk3HOhBy72LwJPtAKmLLmsYbUoql9wKXiYPmMohaxBdYtK6QyQIPCTTm3SfDrekaqgqmQpTtkk/JPndJGqktL9J6h7sIpr6STM24sS+Hwi/nSjI2BnZDlcAhzmFHMZQ0P3O8bqR9hqJJKSUWSv1tUUTGk+R0wl8TIwArlAG4EwBIMOo261XlWJJaAIICkRlHRlyYEjxZsB6OieW82VuFn/qnUi7C8MbDjOhUrXKUcVPdaWZfHRouQir39ut8Dx66K4VfqFnt54DQFN0AOZ9H8La+h5wDLSdKwhqZ+ZluvP+W1rUVUaLv6ZJWYh1+838LhecjotYzV/D7eGRt+oxhhSHOb2cuD2VW0ULQbu8M0yKSl4TT+b+asIvA9X8urjzOtytUpcW2lXy81iPUiMldxBWkEzyaS/ouzrv9FGin19NnTlLIyamYyCqUUTdnnY6DjZfdnxbWcPehi0njN62x3MzeeswKtkLpL6FZZtei+PkUFhCMCE5c9jqD1QMBDQeu516SQo9DW+9IzyaKg4EdQaui26ARM6OxS4M6hNg/oJVtlClICP08/XFsQbloaRTrW8tErkwWUc8Hoq4DzoiPcdwlUVrI6e1DliqU9GPNOhpA3ieEbdTOzLt2wFqMpfpdU7EoQ4sZGUYpSoCqpfnqWs9AF0ZETJJuOIL6U+7DqrImBQ2n1wc611M7qMS29TBZHaN49mxPLYGug0n6VZ59iVbKpPJSD8TGw7YI8wFjaxl5JTndt1KTQenqSztkuTEsQ6dyTVblp7OpEomVJBVviRFHTgl+E/5FKSB9Xlwv7kqJPT5ijlTAy4l6t5KDVG91PQt3WVAnulJnUuSbq8orDJlE4Rks4m4ea3+gAq7GHzaA9kuDKPdftORmzTDloJkebABdM8/tTHVNqjAAPKiL953CogyW8Ji7TZL0LdFRd3va6xf7zpK8qFRrEpN0fl0cxkGNe6XhuVD7iqyVeCRQN+Jjx8SLLIG6wjO4/Xl7UepWeYMOnQ==',
      encryptedPrivateKeyIV: 'TO+DOHH+d1f2RjBk',
      publicKey:
        'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAwPyKYixco3Ihq1x3obkHTkVlJNMwhKlXBzcfYN4Rzk1iWKi2CknE3urn+OiyqfbgAOqSVjFJQUo+v8xKLxCMbqLrZOQzJRiMF2O+h3WcG2SO2sOPUHUusZ10cdxoWGDcYKGaLsVYvvlZeGpT4pJIl6ZJdTk9x+X6jKh7YCWlzTMxm5kxBh8MJXYNvSv3DgnzaqYugybL/F3DAQlHLt8iOCyt2mCrkxlQ3qcqfvmSL3kxwAmt2zxdw5IorCP18mUrB8lGZVwEHVAAV9t+mTFBmjk7lyudDJydzmoHqzzFAorY2vjVoVEKEo+2R17ymQHG704tmPr3u2pPEaOQ6g7GLwIDAQAB',
      recoveryKeyHash: '881018755a30a0723011b84b89b63ae5a1bcec4b7f221ee976cfeaec3441c555',
      setupAt: '2026-03-13T10:58:35.421Z',
    },

    wallet: {
      address: '0x2a5cf958897eeee9df61bc04c927f127df14ffb1',
      smartAccountAddress: '0x6c6Ddabd692a62c563a69868C8264D9ED8a5FB40',
      origin: 'generated',
      encryptedPrivateKey:
        '0b482f44af0ea5154b4deaba52ecc2f2ccf599fd607d492a174000c1e896d4b24030c3f5232240051755599a792b859d6cb5c0cd37238639bde4ad259e9b69ca12ec',
      encryptedPrivateKeyIV: '7e32368c867962526a97b24bdb97b1d3',
      keyAuthTag: 'eeb46b05c4e858239fe86588c88644be',
      keySalt: '179f2c75167fa14796ab1fb711df20cbb81beae89bc45e518d47292cde7d165a',
      encryptedMnemonic:
        '51a7ac21d07d91051679e9fe52a6e6921b38ea98c06a7877a28d8889cbc092e7aa614ad035ca350a52821aad17c277f972c55598775efbd1be06987fc0883ab37e2e378b809549e7860fd74e',
      mnemonicIv: '945c80b75f4c20de9d8fc04f33601309',
      mnemonicAuthTag: 'df6ef5d5946e3bf75d3a336a6b6f9a9f',
      mnemonicSalt: '6761273adf37cacc6dc09def0b154ac0d4d69ce23dfb733450b303081bcdc240',
      smartAccountComputedAt: '2026-03-13T10:58:08.953Z',
    },

    // Real on-chain state — already confirmed on Base Sepolia. Never re-derive or bump this;
    // the whole point is that userStatus[userIdHash] on the real MemberRoleManager contract is
    // already Active, matching FIXTURE_GUARDIAN's own onChainIdentity block.
    onChainIdentity: {
      userIdHash: '0x07f7122372e1cf344c5486def5fd9b271a37a457847df454e8cac09a15ebd57f',
      linkedWallets: [
        {
          address: '0x2a5cf958897eeee9df61bc04c927f127df14ffb1',
          type: 'eoa',
          isWalletActive: true,
          linkedAt: new Date('2026-07-05T16:09:41.000Z'),
          blockchainRef: {
            blockNumber: 43749747,
            contractAddress: '0x61CcF57C332D32c4d906ac64674BBA4E10CCB07B',
            network: 'baseSepolia',
            txHash: '0x4001b498536fb223c34b22f13b5fcb22d49de18d345126a1bf1da9e7ee748ecb',
          },
        },
        {
          address: '0x6c6ddabd692a62c563a69868c8264d9ed8a5fb40',
          type: 'smart-account',
          isWalletActive: true,
          linkedAt: new Date('2026-07-05T16:09:41.000Z'),
          blockchainRef: {
            blockNumber: 43749747,
            contractAddress: '0x61CcF57C332D32c4d906ac64674BBA4E10CCB07B',
            network: 'baseSepolia',
            txHash: '0x4001b498536fb223c34b22f13b5fcb22d49de18d345126a1bf1da9e7ee748ecb',
          },
        },
      ],
      onChainStatus: [
        {
          status: 'Active',
          statusUpdatedAt: new Date('2026-07-05T16:09:41.000Z'),
          statusBlockchainRef: {
            blockNumber: 43749747,
            contractAddress: '0x61CcF57C332D32c4d906ac64674BBA4E10CCB07B',
            network: 'baseSepolia',
            txHash: '0x4001b498536fb223c34b22f13b5fcb22d49de18d345126a1bf1da9e7ee748ecb',
          },
        },
      ],
    },

    // A leftover Sepolia-specific registration block present on this account's real doc but not
    // on FIXTURE_GUARDIAN's — kept verbatim since the whole point of a fixture snapshot is that
    // it's the exact real doc, not a cleaned-up version of it.
    onChainIdentity_sepolia: {
      userIdHash: '0x07f7122372e1cf344c5486def5fd9b271a37a457847df454e8cac09a15ebd57f',
      status: 'Active',
      linkedWallets: [
        {
          address: '0x2A5CF958897EEeE9Df61bC04C927F127DF14fFb1',
          type: 'eoa',
          isWalletActive: true,
          blockNumber: 10438660,
          linkedAt: new Date('2026-03-13T10:58:10.000Z'),
          txHash: '0x3d4cfa7b2d776f938cb91a5eeb8c2c5b201644b1b1f93a4bbe739ba9f4e87fc3',
        },
        {
          address: '0x6c6Ddabd692a62c563a69868C8264D9ED8a5FB40',
          type: 'smart-account',
          isWalletActive: true,
          blockNumber: 10438662,
          linkedAt: new Date('2026-03-13T10:58:38.000Z'),
          txHash: '0x636826c94da94912bfb370e1ea05bfeea9a4998808088b6dc1ee4b5bdbfae654',
        },
      ],
    },
  },
};
