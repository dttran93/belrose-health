// e2e/helpers/fixtures/guardian.ts
//
// A real, pre-existing guardian account — already genuinely registered on Base Sepolia (see
// doc.onChainIdentity.userIdHash / linkedWallets below, both real, both already confirmed
// on-chain) — reused across e2e runs instead of registering a fresh guardian through the UI
// every time.
//
// The Firebase emulator wipes Firestore/Auth on every boot, but the on-chain registration lives
// on the real chain and never resets — so re-seeding this account's real Firestore snapshot back
// in at the start of each run (rather than driving a fresh UI registration) skips both the real
// on-chain guardian-registration call and the email-verification UI flow, while still exercising
// the actual thing dependents.spec.ts tests: the DEPENDENT's own fresh on-chain registration via
// createDependentAccount, which needs a genuinely-registered guardian to bootstrap a trustee
// relationship against (bootstrapDependentTrustee checks the guardian's on-chain status too).
//
// The doc.encryption.* and doc.wallet.* values below are this account's REAL PBKDF2/AES-GCM-derived
// key material for FIXTURE_GUARDIAN.password — they can't be regenerated or faked; they have to be
// the actual values for EncryptionGate's unlock flow to decrypt correctly. Do not "clean up" or
// alter these — they're an exact snapshot of a real Firestore users/{uid} document. Any new
// fixture follows this same recipe: register a real account once through the UI with a chosen
// password, then hand-copy the resulting users/{uid} doc in here.

import type { FixtureUser } from './types';

export const FIXTURE_GUARDIAN: FixtureUser = {
  uid: 'kzGZLEgNZpbWRp7XyEFFsQz3OfB2',
  email: 'belrose.test+2@gmail.com',
  password: 'pleasebeourGuest1!',
  displayName: 'Johnny Hopkins',

  doc: {
    uid: 'kzGZLEgNZpbWRp7XyEFFsQz3OfB2',
    email: 'belrose.test+2@gmail.com',
    emailVerified: true,
    emailVerifiedAt: new Date('2026-03-24T14:40:05.000Z'),
    displayName: 'Johnny Hopkins',
    displayNameLower: 'johnny hopkins',
    firstName: 'Johnny',
    lastName: 'Hopkins',
    identityVerified: true,
    identityVerifiedAt: '2026-05-08T16:00:58.728Z',
    createdAt: new Date('2026-02-20T09:23:46.000Z'),
    updatedAt: new Date('2026-06-24T22:41:54.000Z'),

    encryption: {
      enabled: true,
      encryptedMasterKey:
        'w+iF4CA/7cnJwUFzCEEFJrwuNLgWwGUaqZSSymFTrDm9YApWR8iQ/52nGdLmM15h',
      masterKeyIV: 'YmGFsHRZlIL0vxX/',
      masterKeySalt: 'zZGTnXR18AJdLRdMTH/ROQ==',
      encryptedPrivateKey:
        'XLsvLwu2Ez3lcW4sUSY6B+R8QPRYKmDj7ujN1znG1is14evv1+KfeqNXhbR21iegro3SZYDkoomvCJ1uZL5ZtGPRflNU+emCKJOsXLJFLpbCHOAT6zCNtuqNshMIDLueEWsbBtsBFSHmzhgAcU6TBbrj+fvQUk1qkzRnbl/osRsFaDfMNy45H1Oyk54+lUHhI63lVsEX1RZ3gTXyPI2keXw0QXHKcXlec2bDaW+PQMKutTh46eoSs7F8+VHd/fNTeAdisaeOY8Rfk0QbaxQwE3/Z+KJAKxJEt7su2cBzZZ+W6OtL3p+lg/+ZJu6/FgDi3U8jkWRy3UT4j0z7gBDvtSbT3L3tvDuKZfrVZo6qX47vbNefecrOlkcJbfcg5XHEZl6kxVmEAEUuT8nh0xfFjObl3umO7r/xSZiByoCo2ItOQaYNSqeEu8eaUtbLH3xwCC2//VVhhmTwzGmidTk08w9HYXR+4hGctE4BxMlXA5KFjw32FZSkYXTHwroT6Wzfujyrozf8hGOxzg+0HzpXwkwjdAUOVI3H3hkJvfa/XjB6HpAoXyi9LNzy0a9Wuso/rhFC0hFhOLkFHnlCUglw9PamHRKJLMKGenV16nfI0pzXyx7ys0yF0OqdJXj/kUH9j8U0DJYe9lOu1UOiQW9PeGA1hPjCpuomMdIFhNV0i+Hnas2HSEyPttGMnF00dwRKz2+LdTA+6qpRqE+HKz3ThttMzM6mIbueCU3Rcmg5R1t7LENebnuhU7TNpZJMYTu6uxKGpxC+7erGH2rSe5CH6jXeH4BwexQxPY8QOHwcFEQrlG2b5Yh5sqv1zxMbR4KYq0uFEEqvp7pVnJJmCYsI+gkCcjeYbaLx6yJXoODlnyQTb0ePL7yiD1yTXHFNzmn/4deOhIy3dyQwuhpcV2+g40cdIr/cAYqkoYTLMh15DuWizB/5BktA15P+ekbbZ3lxbkVBRpgdxSafv97zb+dIAotHkg+hBwvsGJw6T1c/Lwa9bW3Rayg+BPvYRe1t4+ffQfVnWiKf2DS7yeiJMpkWI/oqTvPcth84+ZVX/Fp9b4N62pZm6vo0cd757s/C4Z/n0Q6nmO6P8nsQwKY7wUWTCneST6ZYzforcotQWmqAGiPMtt06HK0nOezfSMh/V1vxBtCVmC6aMK3HCOMN1YxzIrpS5rztyDfrAprC6nYX3Ylegsrb/3lyXRDZiEXF51UyAbDqEdUR+v0DuMN//kYKTimS6kPQ6n0tJFHsak+cpossOIdrCFGfqikI4NfNH4EZ4tU/53IO/CFSTh8+mzeuaAT5+P7BwK43KOUSWSwogT8CacAc05tHjRBvelskQMqZNkEJLh+MpHjLNJOZSa0fYyFLVqg+MhRhvjXjJSDQySdkshHNMya/nmyOqK4If7eiY5nYo56piXnqvDLEVMYd5sKbGrw2oFY7+NRrCD4jIO4DM8akuUQBdgCh5hEOVsr18gRTkBqODXIcOV9vnjs5cd1uD9Q9THYA9kCmEpHbn8YyLRsBw63Tj1v24778I0bhsJLUAwal2K46VxTgA6PqTAb1dR60Ctz4jObQuYt8XK1qwP0NKU6PUTuCXgXIA4XRzkWZ9MtUovU8L7GqeDzUsKm6oRxIUBhRMV8s5Attrz4Y',
      encryptedPrivateKeyIV: '0k4jCPoZVEi4diTw',
      publicKey:
        'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAwI8Q8RXDIBHGTL+SMFflhn5ek/1g23yqJe1rLL4FM6SRhhJqINTi5b4Xa1oZVFDiEmlEF8iAOnH+nvMKkwvWr8u4onxupVli5Z1Uu0G//DvDc5LtRAJqKIuNS/51dXSxF4iI0/bp9V0TIN+vrlHR+N08A+ASYVwzQJaZmeNd9iVKwiQwQslnbEcMo5aSOK+zYe3/qeZJ809V8OcsQcc38MDGvDCYLuJbnvxPVtiYekRdXLUgXtrwaguTyNlnAtWNIUukzEWMjd4svRb0r5zditqV6JmL6DwCDsuIB2eB7YcWKpqx9smLwtnxnH0C5Ojlgor7bWQcdQrDLYOl8SExKwIDAQAB',
      recoveryKeyHash:
        '69a276cd1725cfc4ac4e116c706aecbba473d37c75598ea5c95cf9de6060af57',
      setupAt: '2026-02-20T09:23:46.033Z',
    },

    wallet: {
      address: '0x971bc581e996373c080e7c1864bdb1ea4223a2c5',
      smartAccountAddress: '0xC55c1732FCFDAab4f6cFB1C867c441c6cb8Ce2f6',
      origin: 'generated',
      encryptedPrivateKey:
        '5e49aadf1a2fd75f6f72add693a125d4b3064988ddcc8749d4b73f6c2c8c4671f0b8e670cb1f7dd1973081aab1aace8934509ff3991c7ef82a8f13892c95433e07af',
      encryptedPrivateKeyIV: '5dade537a5990f95f7b5ea2ad3e6d262',
      keyAuthTag: '716764a565523c8edcd9cbd693992e08',
      keySalt: '3ee64f4a00d41703b49b61e87d0fa5b49916d742a91f15bdc844660585c0be69',
      encryptedMnemonic:
        '27f6c72b3aff7b51552292195f393db19a8174388b216796a40198886d491865e0b40b3a9632b2d5a220439eedd63eddf15ff06863cd916dd9c099ad14050d925565cb4ecfbf2769b1e1',
      mnemonicIv: 'e79b75da98a0f7cb1a975b01decfa4c0',
      mnemonicAuthTag: '54a2845a3ccadde903620dc8fad7cb0d',
      mnemonicSalt: '920659182b210fa9679421225fad44979d3c2151ba1cfd2e238133613baa1fec',
      smartAccountComputedAt: '2026-02-20T09:23:31.727Z',
    },

    // Real on-chain state — already confirmed on Base Sepolia (block 43749777). Never re-derive
    // or bump this; the whole point is that userStatus[userIdHash] on the real MemberRoleManager
    // contract is already Active, so bootstrapDependentTrustee's "Trustee not registered" check
    // passes without needing a fresh registration call.
    onChainIdentity: {
      userIdHash: '0x861c29680230cdcee64ac8849f06326c75602deeeb033743ce15594450358e9b',
      linkedWallets: [
        {
          address: '0x971bc581e996373c080e7c1864bdb1ea4223a2c5',
          type: 'eoa',
          isWalletActive: true,
          linkedAt: new Date('2026-07-05T16:10:42.000Z'),
          blockchainRef: {
            blockNumber: 43749777,
            contractAddress: '0x61CcF57C332D32c4d906ac64674BBA4E10CCB07B',
            network: 'baseSepolia',
            txHash: '0x922347e3c3d3fb5d83075684c72ad7d47ea73ee3c62a587126c02018e394fe41',
          },
        },
        {
          address: '0xc55c1732fcfdaab4f6cfb1c867c441c6cb8ce2f6',
          type: 'smart-account',
          isWalletActive: true,
          linkedAt: new Date('2026-07-05T16:10:42.000Z'),
          blockchainRef: {
            blockNumber: 43749777,
            contractAddress: '0x61CcF57C332D32c4d906ac64674BBA4E10CCB07B',
            network: 'baseSepolia',
            txHash: '0x922347e3c3d3fb5d83075684c72ad7d47ea73ee3c62a587126c02018e394fe41',
          },
        },
      ],
      onChainStatus: [
        {
          status: 'Active',
          statusUpdatedAt: new Date('2026-07-05T16:10:42.000Z'),
          statusBlockchainRef: {
            blockNumber: 43749777,
            contractAddress: '0x61CcF57C332D32c4d906ac64674BBA4E10CCB07B',
            network: 'baseSepolia',
            txHash: '0x922347e3c3d3fb5d83075684c72ad7d47ea73ee3c62a587126c02018e394fe41',
          },
        },
      ],
    },
  },
};
