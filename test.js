/**
 *
 * @author  晴云
 * @create 2021-08-29 14:16
 * @note 干什么的呢？
 **/

function a() {

  let func = function() {
    console.log('这里是 x 的结果-------------', x)
  }
  let x = 2
  func()
}

a()

function track(target, type, key) {
  if (!isTracking()) {
    return
  }
  let depsMap = targetMap.get(target)
  if (!depsMap) {
    // 每个target对应一个depsMap
    targetMap.set(target, (depsMap = new Map()))
  }
  let dep = depsMap.get(key)
  if (!dep) {
    // 每个 key 对应一个 dep 集合
    depsMap.set(key, (dep = createDep()))
  }
  const eventInfo = (process.env.NODE_ENV !== 'production') ? { effect: activeEffect, target, type, key } : undefined
  trackEffects(dep, eventInfo)
}

function trackEffects(dep, debuggerEventExtraInfo) {
  let shouldTrack = false
  if (effectTrackDepth <= maxMarkerBits) {
    if (!newTracked(dep)) {
      // 标记为新依赖
      dep.n |= trackOpBit
// 如果依赖已经被收集，则不需要再次收集
      shouldTrack = !wasTracked(dep)
    }
  } else {
    // cleanup 模式
    shouldTrack = !dep.has(activeEffect)
  }
  if (shouldTrack) {
    // 收集当前激活的 effect 作为依赖
    dep.add(activeEffect)
// 当前激活的 effect 收集 dep 集合作为依赖
    activeEffect.deps.push(dep)
    if ((process.env.NODE_ENV !== 'production') && activeEffect.onTrack) {
      activeEffect.onTrack(Object.assign({ effect: activeEffect }, debuggerEventExtraInfo))
    }
  }
}
