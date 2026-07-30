export type CartStatus = "open" | "ordered" | "abandoned";

export interface CartLine {
  sku: string;
  quantity: number;
}

export interface Cart {
  id: string;
  lines: CartLine[];
  status: CartStatus;
  note?: string;
}

export declare function totalOf(cart: Cart): number;
