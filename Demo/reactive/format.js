export const PublicInstanceProxyHandlers = {
  get() {
  },//上面已讲过
  set({ _: instance }, key, value) {
    const { data, setupState, ctx } = instance
    if (setupState !== EMPTY_OBJ && hasOwn(setupState, key)) {
      setupState[key] = value
      return true
    } else if (data !== EMPTY_OBJ && hasOwn(data, key)) {
      data[key] = value
      return true
    } else if (hasOwn(instance.props, key)) {
      return false
    }
    if (key[0] === '$' && key.slice(1) in instance) {
      return false
    } else {
        ctx[key] = value
    }
    return true
  }
}
