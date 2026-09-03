import connectToDatabase from "../src/lib/db";
import AnalyticsEvent from "../src/models/AnalyticsEvent";
import mongoose from "mongoose";

process.env.MONGODB_URI = "mongodb+srv://aivrasol_db_user:8s8OIhPXdcXdwfn7@cluster0.cfiidrr.mongodb.net/?appName=Cluster0";

async function run() {
  try {
    await connectToDatabase();
    console.log("Connected successfully");
    
    const events = await AnalyticsEvent.find({ type: "sale.completed" }).sort({ occurred_at: -1 }).limit(1).lean();
    if (events.length > 0) {
      console.log("SALE PAYLOAD:", JSON.stringify(events[0].payload, null, 2));
    }
    
    const returns = await AnalyticsEvent.find({ type: "sale.returned" }).sort({ occurred_at: -1 }).limit(1).lean();
    if (returns.length > 0) {
      console.log("RETURN PAYLOAD:", JSON.stringify(returns[0].payload, null, 2));
    }
    
    const purchases = await AnalyticsEvent.find({ type: "purchase.received" }).sort({ occurred_at: -1 }).limit(1).lean();
    if (purchases.length > 0) {
      console.log("PURCHASE PAYLOAD:", JSON.stringify(purchases[0].payload, null, 2));
    }
    
    const agg = await AnalyticsEvent.aggregate([
      { $match: { _id: events[0]?._id } },
      {
        $group: {
          _id: "$type",
          gross_sales: { $sum: { $convert: { input: { $ifNull: ["$payload.grossSales", "$payload.gross_sales"] }, to: "double", onError: 0, onNull: 0 } } },
          cogs: { $sum: { $convert: { input: { $ifNull: ["$payload.cogs", "$payload.cogs"] }, to: "double", onError: 0, onNull: 0 } } },
          net_sales: { $sum: { $convert: { input: { $ifNull: ["$payload.netSales", "$payload.net_sales"] }, to: "double", onError: 0, onNull: 0 } } },
          cash_sales: {
            $sum: {
              $cond: [
                { $eq: [{ $ifNull: ["$payload.paymentMethod", "$payload.payment_method"] }, "cash"] },
                { $convert: { input: { $ifNull: ["$payload.netSales", "$payload.net_sales"] }, to: "double", onError: 0, onNull: 0 } },
                0
              ]
            }
          }
        }
      }
    ]);
    console.log("AGGREGATION RESULT FOR SALE:", JSON.stringify(agg, null, 2));
    
  } catch (err) {
    console.error("Error:", err);
  } finally {
    mongoose.disconnect();
  }
}
run();
