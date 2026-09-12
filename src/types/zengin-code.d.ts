declare module "zengin-code" {
  export interface ZenginBranch {
    code: string;
    name: string;
    kana: string;
    hira: string;
    roma: string;
  }
  export interface ZenginBank extends ZenginBranch {
    branches: Record<string, ZenginBranch>;
  }
  const banks: Record<string, ZenginBank>;
  export default banks;
}
