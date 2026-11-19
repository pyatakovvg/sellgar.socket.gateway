import { isUUID, ValidationArguments, ValidatorConstraint, ValidatorConstraintInterface } from 'class-validator';

@ValidatorConstraint({ name: 'deliveryOwner', async: false })
export class DeliveryOwnerConstraint implements ValidatorConstraintInterface {
  validate(value: unknown, args: ValidationArguments): boolean {
    return (args.object as { channel: string }).channel === 'carts'
      ? typeof value === 'string' && isUUID(value)
      : value === undefined;
  }
}
