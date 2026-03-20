/**
 * Banking Tool Registry Tests
 */

import { BankingToolRegistry } from '../../src/tools/BankingToolRegistry';

describe('BankingToolRegistry', () => {
  describe('getAllTools', () => {
    it('should return all banking tools', () => {
      const tools = BankingToolRegistry.getAllTools();
      
      expect(tools).toHaveLength(6);
      expect(tools.map(t => t.name)).toEqual([
        'get_my_accounts',
        'get_account_balance',
        'get_my_transactions',
        'create_deposit',
        'create_withdrawal',
        'create_transfer'
      ]);
    });

    it('should return tools with all required properties', () => {
      const tools = BankingToolRegistry.getAllTools();
      
      tools.forEach(tool => {
        expect(tool).toHaveProperty('name');
        expect(tool).toHaveProperty('description');
        expect(tool).toHaveProperty('inputSchema');
        expect(tool).toHaveProperty('requiresUserAuth');
        expect(tool).toHaveProperty('requiredScopes');
        expect(tool).toHaveProperty('handler');
        
        expect(typeof tool.name).toBe('string');
        expect(typeof tool.description).toBe('string');
        expect(typeof tool.inputSchema).toBe('object');
        expect(typeof tool.requiresUserAuth).toBe('boolean');
        expect(Array.isArray(tool.requiredScopes)).toBe(true);
        expect(typeof tool.handler).toBe('string');
      });
    });
  });

  describe('getTool', () => {
    it('should return tool definition for valid tool name', () => {
      const tool = BankingToolRegistry.getTool('get_my_accounts');
      
      expect(tool).toBeDefined();
      expect(tool?.name).toBe('get_my_accounts');
      expect(tool?.description).toBe('Retrieve user\'s bank accounts');
      expect(tool?.requiresUserAuth).toBe(true);
      expect(tool?.requiredScopes).toEqual(['banking:accounts:read']);
      expect(tool?.handler).toBe('executeGetMyAccounts');
    });

    it('should return undefined for invalid tool name', () => {
      const tool = BankingToolRegistry.getTool('invalid_tool');
      expect(tool).toBeUndefined();
    });
  });

  describe('getToolNames', () => {
    it('should return all tool names', () => {
      const names = BankingToolRegistry.getToolNames();
      
      expect(names).toEqual([
        'get_my_accounts',
        'get_account_balance',
        'get_my_transactions',
        'create_deposit',
        'create_withdrawal',
        'create_transfer'
      ]);
    });
  });

  describe('hasTool', () => {
    it('should return true for existing tools', () => {
      expect(BankingToolRegistry.hasTool('get_my_accounts')).toBe(true);
      expect(BankingToolRegistry.hasTool('create_transfer')).toBe(true);
    });

    it('should return false for non-existing tools', () => {
      expect(BankingToolRegistry.hasTool('invalid_tool')).toBe(false);
      expect(BankingToolRegistry.hasTool('')).toBe(false);
    });
  });

  describe('getToolsByScope', () => {
    it('should return tools with banking:accounts:read scope', () => {
      const tools = BankingToolRegistry.getToolsByScope('banking:accounts:read');
      
      expect(tools).toHaveLength(2);
      expect(tools.map(t => t.name)).toEqual([
        'get_my_accounts',
        'get_account_balance'
      ]);
    });

    it('should return tools with banking:transactions:read scope', () => {
      const tools = BankingToolRegistry.getToolsByScope('banking:transactions:read');
      
      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe('get_my_transactions');
    });

    it('should return tools with banking:transactions:write scope', () => {
      const tools = BankingToolRegistry.getToolsByScope('banking:transactions:write');
      
      expect(tools).toHaveLength(3);
      expect(tools.map(t => t.name)).toEqual([
        'create_deposit',
        'create_withdrawal',
        'create_transfer'
      ]);
    });

    it('should return empty array for non-existing scope', () => {
      const tools = BankingToolRegistry.getToolsByScope('invalid:scope');
      expect(tools).toHaveLength(0);
    });
  });

  describe('getMCPToolDefinitions', () => {
    it('should return MCP-compatible tool definitions without handler property', () => {
      const mcpTools = BankingToolRegistry.getMCPToolDefinitions();
      
      expect(mcpTools).toHaveLength(6);
      
      mcpTools.forEach(tool => {
        expect(tool).toHaveProperty('name');
        expect(tool).toHaveProperty('description');
        expect(tool).toHaveProperty('inputSchema');
        expect(tool).toHaveProperty('requiresUserAuth');
        expect(tool).toHaveProperty('requiredScopes');
        expect(tool).not.toHaveProperty('handler');
      });
    });
  });

  describe('Tool Schema Validation', () => {
    it('should have valid schemas for all tools', () => {
      const tools = BankingToolRegistry.getAllTools();
      
      tools.forEach(tool => {
        expect(tool.inputSchema.type).toBe('object');
        expect(tool.inputSchema).toHaveProperty('properties');
        expect(tool.inputSchema).toHaveProperty('required');
        expect(tool.inputSchema.additionalProperties).toBe(false);
      });
    });

    it('should have correct schema for get_my_accounts', () => {
      const tool = BankingToolRegistry.getTool('get_my_accounts');
      
      expect(tool?.inputSchema.properties).toEqual({});
      expect(tool?.inputSchema.required).toEqual([]);
    });

    it('should have correct schema for get_account_balance', () => {
      const tool = BankingToolRegistry.getTool('get_account_balance');
      
      expect(tool?.inputSchema.properties).toHaveProperty('account_id');
      expect(tool?.inputSchema.required).toEqual(['account_id']);
      
      const accountIdSchema = tool?.inputSchema.properties?.account_id;
      expect(accountIdSchema.type).toBe('string');
      expect(accountIdSchema.minLength).toBe(1);
    });

    it('should have correct schema for create_deposit', () => {
      const tool = BankingToolRegistry.getTool('create_deposit');
      
      expect(tool?.inputSchema.properties).toHaveProperty('to_account_id');
      expect(tool?.inputSchema.properties).toHaveProperty('amount');
      expect(tool?.inputSchema.properties).toHaveProperty('description');
      expect(tool?.inputSchema.required).toEqual(['to_account_id', 'amount']);
      
      const amountSchema = tool?.inputSchema.properties?.amount;
      expect(amountSchema.type).toBe('number');
      expect(amountSchema.minimum).toBe(0.01);
      expect(amountSchema.multipleOf).toBe(0.01);
    });

    it('should have correct schema for create_transfer', () => {
      const tool = BankingToolRegistry.getTool('create_transfer');
      
      expect(tool?.inputSchema.properties).toHaveProperty('from_account_id');
      expect(tool?.inputSchema.properties).toHaveProperty('to_account_id');
      expect(tool?.inputSchema.properties).toHaveProperty('amount');
      expect(tool?.inputSchema.properties).toHaveProperty('description');
      expect(tool?.inputSchema.required).toEqual(['from_account_id', 'to_account_id', 'amount']);
    });
  });

  describe('Tool Authentication Requirements', () => {
    it('should require user authentication for all tools', () => {
      const tools = BankingToolRegistry.getAllTools();
      
      tools.forEach(tool => {
        expect(tool.requiresUserAuth).toBe(true);
      });
    });

    it('should have appropriate scopes for read operations', () => {
      const readTools = ['get_my_accounts', 'get_account_balance', 'get_my_transactions'];
      
      readTools.forEach(toolName => {
        const tool = BankingToolRegistry.getTool(toolName);
        expect(tool?.requiredScopes).toContain(
          toolName.includes('transaction') ? 'banking:transactions:read' : 'banking:accounts:read'
        );
      });
    });

    it('should have appropriate scopes for write operations', () => {
      const writeTools = ['create_deposit', 'create_withdrawal', 'create_transfer'];
      
      writeTools.forEach(toolName => {
        const tool = BankingToolRegistry.getTool(toolName);
        expect(tool?.requiredScopes).toContain('banking:transactions:write');
      });
    });
  });
});