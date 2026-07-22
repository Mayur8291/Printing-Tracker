import "./picklist.css";
import {
  deriveTotalItems,
  displayComment,
  displayShelfCode,
  formatPickupDate,
  formatPicklistCreatedAt
} from "./picklistFormat.js";

/**
 * @param {import('./picklistTypes.js').PicklistData} props.data
 * @param {{ barcodeDataUri: string, logoSrc: string }} props.assets
 */
export default function PicklistTemplate({ data, assets }) {
  const totalItems = deriveTotalItems(data.items);
  const createdLabel = formatPicklistCreatedAt(data.createdAt);
  const barcodeCaption = `*${data.picklistNo}*`;

  return (
    <article className="picklist-doc">
      <h1 className="picklist-title">Picking List</h1>

      <section className="picklist-header">
        <div className="picklist-header-left">
          <div>
            <span className="picklist-label">Picklist No:</span>
            {data.picklistNo}
          </div>
          <img className="picklist-barcode" src={assets.barcodeDataUri} alt={barcodeCaption} />
          <div className="picklist-barcode-caption">{barcodeCaption}</div>
        </div>
        <div className="picklist-header-center">
          <span className="picklist-label">Total Items:</span>
          {totalItems}
        </div>
        <div className="picklist-header-right">
          <span className="picklist-label">Created:</span>
          {createdLabel}
        </div>
      </section>

      <section className="picklist-signoff">
        <div>
          <span className="picklist-label">Picked By:</span>{" "}
          <span className="picklist-signoff-line" />
        </div>
        <div>
          <span className="picklist-label">Pick Start Time:</span>{" "}
          <span className="picklist-signoff-line" />
        </div>
        <div>
          <span className="picklist-label">Pick End Time:</span>{" "}
          <span className="picklist-signoff-line" />
        </div>
      </section>

      <table className="picklist-items-table">
        <colgroup>
          <col className="picklist-col-slno" />
          <col className="picklist-col-sku" />
          <col className="picklist-col-name" />
          <col className="picklist-col-shelf" />
          <col className="picklist-col-comment" />
          <col className="picklist-col-pickupdate" />
          <col className="picklist-col-qty" />
        </colgroup>
        <thead>
          <tr>
            <th>Sl.No.</th>
            <th>SKU Code</th>
            <th>Sku Name</th>
            <th>Shelf Code</th>
            <th>Comment</th>
            <th>PICKUPDATE</th>
            <th>Qty</th>
          </tr>
        </thead>
        <tbody>
          <tr className="picklist-banner-row">
            <td colSpan={7}>PICK THESE ITEMS (Total Items to Pick: {totalItems})</td>
          </tr>
          {(data.items ?? []).map((item) => (
            <tr key={`${item.slNo}-${item.skuCode}`}>
              <td className="picklist-col-slno">{item.slNo}</td>
              <td className="picklist-col-sku">{item.skuCode}</td>
              <td className="picklist-col-name picklist-sku-name">{item.skuName}</td>
              <td className="picklist-col-shelf">{displayShelfCode(item.shelfCode)}</td>
              <td className="picklist-col-comment">{displayComment(item.comment)}</td>
              <td className="picklist-col-pickupdate">{formatPickupDate(item.pickupDate)}</td>
              <td className="picklist-col-qty">{item.qty}</td>
            </tr>
          ))}
          <tr className="picklist-brand-row">
            <td colSpan={7}>
              <span className="picklist-brand-inner">
                <img className="picklist-brand-logo" src={assets.logoSrc} alt="Scott" />
                <span>Scott ERP System</span>
              </span>
            </td>
          </tr>
        </tbody>
      </table>

      <table className="picklist-orders-table">
        <colgroup>
          <col className="picklist-order-col-number" />
          <col className="picklist-order-col-customer" />
        </colgroup>
        <thead>
          <tr>
            <th>Sale Order Number</th>
            <th>Customer Name</th>
          </tr>
        </thead>
        <tbody>
          {(data.orders ?? []).map((order) => (
            <tr key={order.saleOrderNumber}>
              <td className="picklist-order-col-number">{order.saleOrderNumber}</td>
              <td className="picklist-order-col-customer">{order.customerName}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </article>
  );
}
