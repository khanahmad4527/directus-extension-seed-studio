import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  formatForColumnType,
  localDate,
  localDateTime,
  localTime,
} from '../src/core/date-format.js';

/**
 * These assertions must hold in every timezone. The suite is run under a
 * non-UTC TZ in CI for exactly that reason — the original bug was invisible
 * under TZ=UTC, which is the default on hosted runners.
 */
describe('naive column types are wall-clock, not UTC', () => {
  it('round-trips a dateTime string unchanged', () => {
    // JS parses a zone-less string as local, so formatting must be local too.
    const input = '2024-01-01T10:00:00';
    const parsed = new Date(input);
    assert.equal(formatForColumnType(parsed, 'dateTime'), input);
  });

  it('round-trips a date string unchanged', () => {
    const parsed = new Date('2024-03-09T00:30:00');
    assert.equal(formatForColumnType(parsed, 'date'), '2024-03-09');
  });

  it('round-trips a dateTime near midnight, where a UTC shift changes the day', () => {
    const input = '2024-03-09T00:30:00';
    assert.equal(formatForColumnType(new Date(input), 'dateTime'), input);
  });

  it('round-trips a dateTime late in the day', () => {
    const input = '2024-06-30T23:45:10';
    assert.equal(formatForColumnType(new Date(input), 'dateTime'), input);
  });

  it('emits no zone marker for naive types', () => {
    const date = new Date('2024-01-01T10:00:00');
    for (const type of ['date', 'time', 'dateTime']) {
      assert.ok(!formatForColumnType(date, type).endsWith('Z'), type);
      assert.ok(!formatForColumnType(date, type).includes('+'), type);
    }
  });

  it('pads every component to two digits', () => {
    const date = new Date(2024, 0, 2, 3, 4, 5);
    assert.equal(localDate(date), '2024-01-02');
    assert.equal(localTime(date), '03:04:05');
    assert.equal(localDateTime(date), '2024-01-02T03:04:05');
  });
});

describe('timestamp stays timezone-aware', () => {
  it('keeps UTC and the Z marker', () => {
    const date = new Date('2024-01-01T10:00:00Z');
    assert.equal(formatForColumnType(date, 'timestamp'), '2024-01-01T10:00:00.000Z');
  });

  it('falls back to an ISO instant for an unknown type', () => {
    const date = new Date('2024-01-01T10:00:00Z');
    assert.equal(formatForColumnType(date, 'something-else'), '2024-01-01T10:00:00.000Z');
  });
});

describe('the interface narrows the column type', () => {
  it('a date interface on a timestamp column yields a bare date', () => {
    const date = new Date('2024-05-04T13:20:00');
    assert.equal(formatForColumnType(date, 'timestamp', 'date'), '2024-05-04');
  });

  it('a time interface yields a bare time', () => {
    const date = new Date('2024-05-04T13:20:00');
    assert.equal(formatForColumnType(date, 'timestamp', 'time'), '13:20:00');
  });
});
