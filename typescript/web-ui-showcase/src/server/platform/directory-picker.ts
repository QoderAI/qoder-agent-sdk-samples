export interface DirectoryPicker {
  pick(): Promise<string | null>;
}
