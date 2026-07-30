// Not exported, so it contributes no symbol to the Product slice - it exists
// only so this snapshot compiles on its own. `price` still resolves to a
// `ref` named Money either way, which is how the differ compares it.
interface Money {
  amount: number;
  currency: string;
}

export interface Product {
  sku?: string;
  title?: string;
  tags?: string[];
  price?: Money;
}
