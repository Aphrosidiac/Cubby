import { describe, expect, it } from 'vitest'
import { buildSchedule, cronError, describeSchedule, parseSchedule } from './cron'

describe('flow schedules', () => {
  it('round-trips the presets', () => {
    for (const c of ['15 * * * *', '0 9 * * *', '45 8 * * 1-5']) expect(buildSchedule(parseSchedule(c))).toBe(c)
    expect(parseSchedule('*/30 9-18 * * 1-5')).toEqual({ kind: 'custom', cron: '*/30 9-18 * * 1-5' })
  })

  it('says the common crons in words', () => {
    expect(describeSchedule(null)).toBe('Manual only')
    expect(describeSchedule('0 9 * * *')).toBe('Every day at 9:00 am')
    expect(describeSchedule('45 8 * * 1-5')).toBe('Weekdays at 8:45 am')
    expect(describeSchedule('15 * * * *')).toBe('Every hour at :15')
    expect(describeSchedule('30 10 * * 5')).toBe('Fri at 10:30 am')
    expect(describeSchedule('0 21 * * 1,3')).toBe('Mon, Wed at 9:00 pm')
    expect(describeSchedule('*/30 9-18 * * 1-5')).toBe('Every 30 minutes from 9:00 am to 6:30 pm, weekdays')
    expect(describeSchedule('*/15 * * * *')).toBe('Every 15 minutes')
    expect(describeSchedule('0 */2 * * *')).toBe('Every 2 hours')
    expect(describeSchedule('10 */3 * * 0,6')).toBe('Every 3 hours at :10, weekends')
    expect(describeSchedule('0 9 1 * *')).toBe('Cron: 0 9 1 * *')
  })

  it('flags malformed crons', () => {
    expect(cronError('every day')).toMatch(/five fields/)
    expect(cronError('0 9 * * mon!')).toMatch(/Only numbers/)
    expect(cronError('*/30 9-18 * * 1-5')).toBeNull()
  })
})
