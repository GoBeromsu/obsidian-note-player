export class Plugin {
  app: App
  manifest: any
  loadData() { return Promise.resolve({}) }
  saveData(_data: any) { return Promise.resolve() }
  addCommand(_cmd: any) {}
  addSettingTab(_tab: any) {}
  registerEvent(_ref: any) {}
  registerInterval(_id: number) { return _id }
}
export class Modal {
  app: App
  constructor(_app: App) { this.app = _app }
  open() {}
  close() {}
  onOpen() {}
  onClose() {}
}
export class PluginSettingTab {
  app: App
  plugin: any
  containerEl: HTMLElement = document.createElement('div')
  constructor(_app: App, _plugin: any) {}
  display() {}
}
export class Setting {
  constructor(_el: HTMLElement) {}
  setName(_name: string) { return this }
  setDesc(_desc: string) { return this }
  addText(_cb: any) { return this }
  addToggle(_cb: any) { return this }
}
export class Notice {
  constructor(_msg: string, _timeout?: number) {}
}
export declare class App {}
export const Platform = { isDesktop: true, isMobile: false }
