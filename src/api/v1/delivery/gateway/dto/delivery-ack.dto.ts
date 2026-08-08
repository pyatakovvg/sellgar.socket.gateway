import { IsString, Matches } from 'class-validator';

export class DeliveryAckDto {
  @IsString()
  @Matches(/^(user|tenant|shop|job):[0-9a-f-]{36}$/i)
  room!: string;

  @IsString()
  @Matches(/^\d+$/)
  sequence!: string;
}
