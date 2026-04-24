export const CONTRACT_ADDRESS = (process.env.NEXT_PUBLIC_CONTRACT_ADDRESS ||
  '0x0000000000000000000000000000000000000000') as `0x${string}`

export const SLOT_PRICE_WEI = 10n ** 18n
export const TOTAL_SLOTS = 1000
export const GRID_COLUMNS = 40
export const GRID_ROWS = 25

export const WALL_ABI = [
  {
    type: 'function',
    name: 'mintSpot',
    stateMutability: 'payable',
    inputs: [
      { name: 'slotId', type: 'uint256', internalType: 'uint256' },
      { name: 'imageUri', type: 'string', internalType: 'string' },
      { name: 'note', type: 'string', internalType: 'string' },
      { name: 'isPermanent', type: 'bool', internalType: 'bool' },
    ],
    outputs: [],
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
      { name: 'owner', type: 'address', internalType: 'address' },
      { name: 'imageUri', type: 'string', internalType: 'string' },
      { name: 'note', type: 'string', internalType: 'string' },
      { name: 'isPermanent', type: 'bool', internalType: 'bool' },
      { name: 'mintedAt', type: 'uint256', internalType: 'uint256' },
    ],
  },
  {
    type: 'function',
    name: 'tokenURI',
    stateMutability: 'view',
    inputs: [{ name: 'slotId', type: 'uint256', internalType: 'uint256' }],
    outputs: [{ name: '', type: 'string', internalType: 'string' }],
  },
  {
    type: 'function',
    name: 'walletToSlot',
    stateMutability: 'view',
    inputs: [{ name: 'wallet', type: 'address', internalType: 'address' }],
    outputs: [{ name: '', type: 'uint256', internalType: 'uint256' }],
  },
  {
    type: 'event',
    name: 'SpotMinted',
    anonymous: false,
    inputs: [
      { name: 'slotId', type: 'uint256', indexed: true, internalType: 'uint256' },
      { name: 'owner', type: 'address', indexed: true, internalType: 'address' },
      { name: 'imageUri', type: 'string', indexed: false, internalType: 'string' },
      { name: 'note', type: 'string', indexed: false, internalType: 'string' },
      { name: 'isPermanent', type: 'bool', indexed: false, internalType: 'bool' },
    ],
  },
] as const
