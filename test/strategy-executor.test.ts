import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { StrategyExecutor, invokeFaker } from '../src/endpoint/core/strategy-executor.js';
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

describe('StrategyExecutor.execute', () => {
  const services = { ItemsService: class {} };
  const schema = { collections: {}, fields: {}, relations: [] };
  const accountability = { admin: true };

  it('faker person.firstName returns non-empty string', async () => {
    const exec = new StrategyExecutor(services, schema, accountability);
    const value = await exec.execute({ kind: 'faker', method: 'person.firstName' }, makeField(), 0);
    assert.equal(typeof value, 'string');
    assert.ok((value as string).length > 0);
  });

  it('random_int respects min and max', async () => {
    const exec = new StrategyExecutor(services, schema, accountability);
    for (let i = 0; i < 50; i++) {
      const value = await exec.execute({ kind: 'random_int', min: 1, max: 10 }, makeField({ type: 'integer' }), i);
      assert.ok(typeof value === 'number');
      assert.ok((value as number) >= 1 && (value as number) <= 10);
    }
  });

  it('uuid returns a v4 uuid', async () => {
    const exec = new StrategyExecutor(services, schema, accountability);
    const v = await exec.execute({ kind: 'uuid' }, makeField({ type: 'uuid' }), 0);
    assert.match(String(v), /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('fixed returns the value as-is', async () => {
    const exec = new StrategyExecutor(services, schema, accountability);
    const v = await exec.execute({ kind: 'fixed', value: 42 }, makeField({ type: 'integer' }), 0);
    assert.equal(v, 42);
  });

  it('null returns null', async () => {
    const exec = new StrategyExecutor(services, schema, accountability);
    const v = await exec.execute({ kind: 'null' }, makeField(), 0);
    assert.equal(v, null);
  });

  it('random_choice picks from list', async () => {
    const exec = new StrategyExecutor(services, schema, accountability);
    const choices = ['x', 'y', 'z'];
    for (let i = 0; i < 20; i++) {
      const v = await exec.execute({ kind: 'random_choice', choices }, makeField(), i);
      assert.ok(choices.includes(v as string));
    }
  });

  it('rejects non-allowlisted faker methods', () => {
    assert.throws(() => invokeFaker('definitely.not.real'), /not allowed/);
  });
});
