import { IsString, Matches } from 'class-validator';

export class DeliveryAckDto {
  @IsString()
  @Matches(/^\d+$/)
  sequence!: string;
}
