import { DataTypes, Model, Optional, Sequelize } from 'sequelize';
import { sequelizeConnection } from '../config';
import { IchannelAttributes } from '../interface/';
import { Avtar } from './avtar';
import { Subscribe } from './subscribe';
import { User } from './user';

export type channelInput = Optional<IchannelAttributes, 'id'>;

class Channel extends Model<IchannelAttributes, channelInput> implements IchannelAttributes {
  public id!: number;
  public chanel_uuid: string;
  public UserId: number;
  public channel_name: string;
  public handle: string;
  public discription: string;
  // timestamps!
  public readonly created_at!: Date;
  public readonly updated_at!: Date;
}

Channel.init(
  {
    id: {
      type: DataTypes.INTEGER.UNSIGNED,
      autoIncrement: true,
      primaryKey: true,
    },
    UserId: {
      type: DataTypes.INTEGER,
    },
    chanel_uuid: {
      type: DataTypes.UUID,
    },
    channel_name: {
      type: DataTypes.STRING,
    },
    handle: {
      type: DataTypes.STRING,
    },
    discription: {
      type: DataTypes.STRING,
    },
    created_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      field: 'created_at',
    },
    updated_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      field: 'updated_at',
    },
  },
  {
    timestamps: false,
    sequelize: sequelizeConnection,
    paranoid: true,
    tableName: 'channel',
    modelName: 'Channel',
  }
);
Channel.hasOne(Avtar, { foreignKey: 'channel_id', as: 'Avtar' });
Avtar.belongsTo(Channel, { foreignKey: 'channel_id' });

Channel.hasOne(Subscribe, { foreignKey: 'subscribed_channel_id', as: 'Subscribe' });
Subscribe.belongsTo(Channel, { foreignKey: 'subscribed_channel_id' });
// Avtar.belongsTo(User);

export { Channel };
