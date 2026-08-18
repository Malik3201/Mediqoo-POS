import mongoose, { Schema, Document } from "mongoose";

export interface ISystemSetting extends Document {
  key: string;
  value: string;
  updatedAt: Date;
}

const SystemSettingSchema: Schema = new Schema(
  {
    key: { type: String, required: true, unique: true },
    value: { type: String, required: true },
  },
  { timestamps: true }
);

export default mongoose.models.SystemSetting ||
  mongoose.model<ISystemSetting>("SystemSetting", SystemSettingSchema);
