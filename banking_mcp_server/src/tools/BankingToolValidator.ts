/**
 * Banking Tool Parameter Validator
 * Validates tool parameters against JSON schemas
 */

import { JSONSchema } from '../interfaces/mcp';
import { BankingToolRegistry } from './BankingToolRegistry';

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  sanitizedParams?: Record<string, any>;
}

export class BankingToolValidator {
  /**
   * Validate tool parameters against the tool's schema
   */
  public static validateToolParams(
    toolName: string, 
    params: Record<string, any>
  ): ValidationResult {
    const tool = BankingToolRegistry.getTool(toolName);
    
    if (!tool) {
      return {
        isValid: false,
        errors: [`Unknown tool: ${toolName}`]
      };
    }

    return this.validateAgainstSchema(params, tool.inputSchema);
  }

  /**
   * Validate parameters against a JSON schema
   */
  private static validateAgainstSchema(
    params: Record<string, any>, 
    schema: JSONSchema
  ): ValidationResult {
    const errors: string[] = [];
    const sanitizedParams: Record<string, any> = {};

    // Check if params is an object
    if (schema.type === 'object') {
      if (typeof params !== 'object' || params === null || Array.isArray(params)) {
        return {
          isValid: false,
          errors: ['Parameters must be an object']
        };
      }

      // Check required properties
      if (schema.required) {
        for (const requiredProp of schema.required) {
          if (!(requiredProp in params)) {
            errors.push(`Missing required parameter: ${requiredProp}`);
          }
        }
      }

      // Validate each property
      if (schema.properties) {
        for (const [propName, propSchema] of Object.entries(schema.properties)) {
          const value = params[propName];
          
          // Skip validation if property is not provided and not required
          if (value === undefined) {
            if (schema.required?.includes(propName)) {
              // Already handled above
            }
            continue;
          }

          const propValidation = this.validateProperty(propName, value, propSchema as any);
          if (!propValidation.isValid) {
            errors.push(...propValidation.errors);
          } else {
            // Always include the sanitized value (or original if no sanitization needed)
            sanitizedParams[propName] = propValidation.sanitizedValue !== undefined 
              ? propValidation.sanitizedValue 
              : value;
          }
        }
      }

      // Check for additional properties if not allowed
      if (schema.additionalProperties === false) {
        const allowedProps = new Set(Object.keys(schema.properties || {}));
        for (const propName of Object.keys(params)) {
          if (!allowedProps.has(propName)) {
            errors.push(`Additional property not allowed: ${propName}`);
          }
        }
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      sanitizedParams: errors.length === 0 ? sanitizedParams : undefined
    };
  }

  /**
   * Validate a single property
   */
  private static validateProperty(
    propName: string, 
    value: any, 
    schema: any
  ): { isValid: boolean; errors: string[]; sanitizedValue?: any } {
    const errors: string[] = [];
    let sanitizedValue = value;

    // Type validation
    if (schema.type) {
      switch (schema.type) {
        case 'string':
          if (typeof value !== 'string') {
            errors.push(`${propName} must be a string`);
            break;
          }
          
          // String length validation
          if (schema.minLength && value.length < schema.minLength) {
            errors.push(`${propName} must be at least ${schema.minLength} characters long`);
          }
          if (schema.maxLength && value.length > schema.maxLength) {
            errors.push(`${propName} must be at most ${schema.maxLength} characters long`);
          }
          
          // Trim whitespace for string values
          sanitizedValue = value.trim();
          if (schema.minLength && sanitizedValue.length < schema.minLength) {
            errors.push(`${propName} must be at least ${schema.minLength} characters long after trimming`);
          }
          break;

        case 'number':
          if (typeof value !== 'number' || isNaN(value) || !isFinite(value)) {
            errors.push(`${propName} must be a valid number`);
            break;
          }
          
          // Number range validation
          if (schema.minimum !== undefined && value < schema.minimum) {
            errors.push(`${propName} must be at least ${schema.minimum}`);
          }
          if (schema.maximum !== undefined && value > schema.maximum) {
            errors.push(`${propName} must be at most ${schema.maximum}`);
          }
          
          // Round to appropriate decimal places for currency first
          if (schema.multipleOf === 0.01) {
            sanitizedValue = Math.round(value * 100) / 100;
          }
          
          // Multiple validation (use sanitized value for currency)
          if (schema.multipleOf) {
            const valueToCheck = schema.multipleOf === 0.01 ? sanitizedValue : value;
            const remainder = Math.abs(valueToCheck % schema.multipleOf);
            const tolerance = schema.multipleOf / 1000; // Small tolerance for floating point
            if (remainder > tolerance && (schema.multipleOf - remainder) > tolerance) {
              errors.push(`${propName} must be a multiple of ${schema.multipleOf}`);
            }
          }
          break;

        case 'boolean':
          if (typeof value !== 'boolean') {
            errors.push(`${propName} must be a boolean`);
          }
          break;

        case 'array':
          if (!Array.isArray(value)) {
            errors.push(`${propName} must be an array`);
          }
          break;

        case 'object':
          if (typeof value !== 'object' || value === null || Array.isArray(value)) {
            errors.push(`${propName} must be an object`);
          }
          break;
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      sanitizedValue: errors.length === 0 ? sanitizedValue : undefined
    };
  }

  /**
   * Validate that required scopes are present in user token scopes
   */
  public static validateScopes(
    toolName: string, 
    userScopes: string[]
  ): ValidationResult {
    const tool = BankingToolRegistry.getTool(toolName);
    
    if (!tool) {
      return {
        isValid: false,
        errors: [`Unknown tool: ${toolName}`]
      };
    }

    const missingScopes = tool.requiredScopes.filter(
      requiredScope => !userScopes.includes(requiredScope)
    );

    if (missingScopes.length > 0) {
      return {
        isValid: false,
        errors: [`Missing required scopes: ${missingScopes.join(', ')}`]
      };
    }

    return {
      isValid: true,
      errors: []
    };
  }
}