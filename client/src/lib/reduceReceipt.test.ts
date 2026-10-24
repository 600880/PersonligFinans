import { describe, expect, it } from 'vitest'
import { reducedSize } from './reduceReceipt'

describe('reducedSize', () => {
  it('fits a large landscape photo within 2048 wide, keeping its proportions', () => {
    expect(reducedSize(4032, 3024)).toEqual({ width: 2048, height: 1536 })
  })

  it('fits a large portrait photo within 2048 high, keeping its proportions', () => {
    expect(reducedSize(3000, 4000)).toEqual({ width: 1536, height: 2048 })
  })

  it('leaves a photo already within bounds as it is, never enlarging it', () => {
    expect(reducedSize(1200, 1600)).toEqual({ width: 1200, height: 1600 })
    expect(reducedSize(2048, 2048)).toEqual({ width: 2048, height: 2048 })
  })

  it('fits a long narrow strip by its long side, keeping its proportions', () => {
    expect(reducedSize(800, 10240)).toEqual({ width: 160, height: 2048 })
  })
})
