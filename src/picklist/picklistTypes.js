/**
 * @typedef {Object} PicklistItem
 * @property {number} slNo
 * @property {string} skuCode
 * @property {string} skuName
 * @property {string} shelfCode
 * @property {string|null|undefined} [comment]
 * @property {string|Date} pickupDate
 * @property {number} qty
 */

/**
 * @typedef {Object} PicklistOrder
 * @property {string} saleOrderNumber
 * @property {string} customerName
 */

/**
 * @typedef {Object} PicklistData
 * @property {string} picklistNo
 * @property {string|Date} createdAt
 * @property {PicklistItem[]} items
 * @property {PicklistOrder[]} orders
 */

/** @type {PicklistData} */
export const SAMPLE_PICKLIST_DATA = {
  picklistNo: "PK39506",
  createdAt: "2026-07-20T17:18:00",
  items: [
    {
      slNo: 1,
      skuCode: "sp22xxxxl",
      skuName: "SCOTT- ORGANIC POLO- MEN- MAROON WITH WHITE TIPPING-4XL",
      shelfCode: "F1-R9-RC",
      comment: null,
      pickupDate: "2026-07-20",
      qty: 1
    }
  ],
  orders: [{ saleOrderNumber: "P-54478", customerName: "S PRIME CORPORATE WEAR" }]
};
