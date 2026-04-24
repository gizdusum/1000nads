export type Slot = {
  id: number
  imageUri: string | null
  owner: string | null
  mintedAt: number | null
  note?: string
  isPermanent?: boolean
}

export function createMockSlots(total: number) {
  return Array.from({ length: total }, (_, index) => ({
    id: index,
    imageUri: null,
    owner: null,
    mintedAt: null,
    note: '',
    isPermanent: false,
  }))
}
