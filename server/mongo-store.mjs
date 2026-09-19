import mongoose from 'mongoose';
const schema = new mongoose.Schema({kind: {type: String, required: true}, id: {type: String, required: true}, data: {type: mongoose.Schema.Types.Mixed, required: true}, updatedAt: {type: String, required: true}}, {versionKey: false});
schema.index({kind: 1, id: 1}, {unique: true}); schema.index({kind: 1, updatedAt: -1});
const Record = mongoose.models.SalonRecord || mongoose.model('SalonRecord', schema);
const limits = new mongoose.Schema({key: {type: String, unique: true}, count: Number, expires: {type: Date, index: {expires: 0}}}, {versionKey: false});
const Limit = mongoose.models.SalonLimit || mongoose.model('SalonLimit', limits);
const unpack = r => r ? {...r.data, id: r.id, kind: r.kind, updatedAt: r.updatedAt} : null;
export async function connectMongo(uri) {
  if (!uri) throw new Error('MONGODB_URI is required.');
  await mongoose.connect(uri, {serverSelectionTimeoutMS: 10000, maxPoolSize: 10});
  await Promise.all([Record.init(), Limit.init()]);
  return {
    get: async (kind, id) => unpack(await Record.findOne({kind, id}).lean()),
    list: async kind => (await Record.find({kind}).sort({updatedAt: -1}).limit(2000).lean()).map(unpack),
    put: async (kind, id, data) => { const updatedAt = new Date().toISOString(); await Record.updateOne({kind, id}, {$set: {data, updatedAt}}, {upsert: true}); return {...data, id, kind, updatedAt}; },
    insert: async (kind, id, data) => { try { await Record.create({kind, id, data, updatedAt: new Date().toISOString()}); return true; } catch (error) { if (error.code === 11000) return false; throw error; } },
    remove: async (kind, id) => { await Record.deleteOne({kind, id}); },
    removeAll: async kind => { await Record.deleteMany({kind}); },
    replaceOwner: async (version, data) => (await Record.updateOne({kind: 'admin', id: 'owner', 'data.authVersion': version}, {$set: {data, updatedAt: new Date().toISOString()}})).modifiedCount === 1,
    prune: async () => {
      await Limit.deleteMany({expires: {$lte: new Date()}});
      await Record.deleteMany({kind: {$in: ['sessions', 'mfa-pending', 'mfa-used']}, 'data.expires': {$type: 'number', $lte: Date.now()}});
    },
    increment: async (key, seconds, amount = 1) => {
      const now = new Date(), expiry = new Date(Date.now() + seconds * 1000);
      const update = [{$set: {key: {$literal: key}, count: {$cond: [{$gt: ['$expires', now]}, {$add: [{$ifNull: ['$count', 0]}, amount]}, amount]}, expires: {$cond: [{$gt: ['$expires', now]}, '$expires', expiry]}}}];
      let record;
      try { record = await Limit.findOneAndUpdate({key}, update, {upsert: true, new: true, updatePipeline: true}); }
      catch (error) { if (error.code !== 11000) throw error; record = await Limit.findOneAndUpdate({key}, update, {new: true, updatePipeline: true}); }
      if (!record) throw new Error('Rate limit unavailable');
      return record.count;
    },
    close: () => mongoose.disconnect(),
  };
}
