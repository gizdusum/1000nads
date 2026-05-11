export const CONTRACT_ADDRESS = (process.env.NEXT_PUBLIC_CONTRACT_ADDRESS ||
  '0x0000000000000000000000000000000000000000') as `0x${string}`

export const SLOT_PRICE_WEI  = 10n ** 18n          // 1 MON
export const MEGA_PRICE_4W   = 40n * 10n ** 18n    // 40 MON
export const MEGA_PRICE_6W   = 60n * 10n ** 18n    // 60 MON
export const TOTAL_SLOTS     = 1000
export const GRID_COLUMNS    = 40
export const GRID_ROWS       = 25

export type MegaBlock = { anchorId: number; colSpan: number; rowSpan?: number; hiddenIds: number[] }

export const MEGA_BLOCKS: MegaBlock[] = [
  { anchorId: 132, colSpan: 6, hiddenIds: [133, 134, 135, 136, 137] },
  { anchorId: 469, colSpan: 6, hiddenIds: [470, 471, 472, 473, 474] },
  { anchorId: 764, colSpan: 6, hiddenIds: [765, 766, 767, 768, 769] },
  { anchorId:  47, colSpan: 4, hiddenIds: [ 48,  49,  50] },
  { anchorId: 142, colSpan: 8, rowSpan: 4, hiddenIds: [
    143, 144, 145, 146, 147, 148, 149,           // row 3 (cols 23-29)
    182, 183, 184, 185, 186, 187, 188, 189,       // row 4 (cols 22-29)
    222, 223, 224, 225, 226, 227, 228, 229,       // row 5 (cols 22-29)
    262, 263, 264, 265, 266, 267, 268, 269,       // row 6 (cols 22-29)
  ] }, // Anago — Monad's immortal mascot
  { anchorId: 231, colSpan: 4, hiddenIds: [232, 233, 234] },
  { anchorId: 248, colSpan: 4, hiddenIds: [249, 250, 251] },
  { anchorId: 337, colSpan: 4, hiddenIds: [338, 339, 340] },
  { anchorId: 422, colSpan: 4, hiddenIds: [423, 424, 425] },
  { anchorId: 562, colSpan: 4, hiddenIds: [563, 564, 565] },
  { anchorId: 652, colSpan: 4, hiddenIds: [653, 654, 655] },
  { anchorId: 704, colSpan: 4, hiddenIds: [705, 706, 707] },
  { anchorId: 845, colSpan: 4, hiddenIds: [846, 847, 848] },
  { anchorId: 915, colSpan: 4, hiddenIds: [916, 917, 918] },
]

const HIDDEN_IDS = new Set(MEGA_BLOCKS.flatMap(m => m.hiddenIds))
const ANCHOR_MAP = new Map(MEGA_BLOCKS.map(m => [m.anchorId, m]))

export function getMegaBlock(slotId: number): MegaBlock | undefined {
  return ANCHOR_MAP.get(slotId)
}

export function isHiddenSlot(slotId: number): boolean {
  return HIDDEN_IDS.has(slotId)
}

export function getMintPrice(slotId: number): bigint {
  const mb = ANCHOR_MAP.get(slotId)
  if (!mb) return SLOT_PRICE_WEI
  return mb.colSpan === 6 ? MEGA_PRICE_6W : MEGA_PRICE_4W
}

export const WALL_ABI = [
  {
    type: 'function',
    name: 'mintSpot',
    stateMutability: 'payable',
    inputs: [
      { name: 'slotId',     type: 'uint256', internalType: 'uint256' },
      { name: 'imageUri',   type: 'string',  internalType: 'string'  },
      { name: 'note',       type: 'string',  internalType: 'string'  },
      { name: 'isPermanent',type: 'bool',    internalType: 'bool'    },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'slotPrice',
    stateMutability: 'view',
    inputs: [{ name: 'slotId', type: 'uint256', internalType: 'uint256' }],
    outputs: [{ name: '', type: 'uint256', internalType: 'uint256' }],
  },
  {
    type: 'function',
    name: 'ownerOfSlot',
    stateMutability: 'view',
    inputs: [{ name: 'slotId', type: 'uint256', internalType: 'uint256' }],
    outputs: [{ name: '', type: 'address', internalType: 'address' }],
  },
  {
    type: 'function',
    name: 'spotData',
    stateMutability: 'view',
    inputs: [{ name: 'slotId', type: 'uint256', internalType: 'uint256' }],
    outputs: [
      { name: 'owner',       type: 'address', internalType: 'address'  },
      { name: 'imageUri',    type: 'string',  internalType: 'string'   },
      { name: 'note',        type: 'string',  internalType: 'string'   },
      { name: 'isPermanent', type: 'bool',    internalType: 'bool'     },
      { name: 'mintedAt',    type: 'uint256', internalType: 'uint256'  },
    ],
  },
  {
    type: 'function',
    name: 'walletToSlot',
    stateMutability: 'view',
    inputs: [{ name: 'wallet', type: 'address', internalType: 'address' }],
    outputs: [{ name: '', type: 'uint256', internalType: 'uint256' }],
  },
  {
    type: 'function',
    name: 'adminClearSlot',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'slotId', type: 'uint256', internalType: 'uint256' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'setPremiumPrice',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'slotId', type: 'uint256', internalType: 'uint256' },
      { name: 'price',  type: 'uint256', internalType: 'uint256' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'withdraw',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'to', type: 'address', internalType: 'address payable' }],
    outputs: [],
  },
  {
    type: 'event',
    name: 'SpotMinted',
    anonymous: false,
    inputs: [
      { name: 'slotId',      type: 'uint256', indexed: true,  internalType: 'uint256' },
      { name: 'owner',       type: 'address', indexed: true,  internalType: 'address' },
      { name: 'imageUri',    type: 'string',  indexed: false, internalType: 'string'  },
      { name: 'note',        type: 'string',  indexed: false, internalType: 'string'  },
      { name: 'isPermanent', type: 'bool',    indexed: false, internalType: 'bool'    },
    ],
  },
] as const
