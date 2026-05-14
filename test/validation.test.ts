import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  clampNumber,
  formatSequence,
  postProcessValue,
  truncateString,
} from '../src/endpoint/core/validation.js';
import type { FieldDescriptor } from '../src/endpoint/types.js';

function makeField(over: Partial<FieldDescriptor> = {}): FieldDescriptor {
  return {
    field: 'f',
    type: 'string',
    interface: null,
    required: false,
    nullable: true,
    readonly: false,
    isPrimaryKey: false,
    isSystemField: false,
    relation: null,
    options: null,
    special: [],
    validation: null,
    defaultValue: null,
    suggestedStrategy: { kind: 'fixed', value: '' },
    ...over,
  };
}

describe('validation utilities', () => {
  it('truncates strings longer than maxLength', () => {
    assert.equal(truncateString('abcdef', 3), 'abc');
    assert.equal(truncateString('abc', 5), 'abc');
    assert.equal(truncateString('abc', null), 'abc');
  });

  it('clamps numbers into min/max range', () => {
    assert.equal(clampNumber(5, 0, 10), 5);
    assert.equal(clampNumber(-5, 0, 10), 0);
    assert.equal(clampNumber(50, 0, 10), 10);
  });

  it('postProcessValue truncates string by maxLength', () => {
    const v = postProcessValue('hello world', makeField({ maxLength: 5 }), 0);
    assert.equal(v, 'hello');
  });

  it('postProcessValue clamps numbers by validation.min/max', () => {
    const v = postProcessValue(
      1000,
      makeField({ type: 'integer', validation: { min: 0, max: 99 } }),
      0
    );
    assert.equal(v, 99);
  });

  it('formatSequence pads INV-{0000} with zeros', () => {
    assert.equal(formatSequence('INV-{0000}', 42), 'INV-0042');
    assert.equal(formatSequence('INV-{0000}', 0), 'INV-0000');
    assert.equal(formatSequence('INV-{0000}', 1234), 'INV-1234');
  });

  it('formatSequence respects startFrom', () => {
    assert.equal(formatSequence('N-{000}', 5, 100), 'N-105');
  });
});
