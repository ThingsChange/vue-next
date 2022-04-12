import { TrackOpTypes, TriggerOpTypes } from './operations'
import { extend, isArray, isIntegerKey, isMap } from '@vue/shared'
import { EffectScope, recordEffectScope } from './effectScope'
import {
  createDep,
  Dep,
  finalizeDepMarkers,
  initDepMarkers,
  newTracked,
  wasTracked
} from './dep'
import { ComputedRefImpl } from './computed'

// The main WeakMap that stores {target -> key -> dep} connections.
// Conceptually, it's easier to think of a dependency as a Dep class
// which maintains a Set of subscribers, but we simply store them as
// raw Sets to reduce memory overhead.
type KeyToDepMap = Map<any, Dep>
const targetMap = new WeakMap<any, KeyToDepMap>()

// The number of effects currently being tracked recursively.
//表示递归嵌套执行  effect 函数的深度，最大深度为30取决于位运算，带符号位运算超过30则溢出
let effectTrackDepth = 0
//用于标识依赖收集的状态
export let trackOpBit = 1

/**
 * The bitwise track markers support at most 30 levels of recursion.
 * This value is chosen to enable modern JS engines to use a SMI on all platforms.
 * When recursion depth is greater, fall back to using a full cleanup.
 * 表示最大标记的位数
 */
const maxMarkerBits = 30

export type EffectScheduler = (...args: any[]) => any

export type DebuggerEvent = {
  effect: ReactiveEffect
} & DebuggerEventExtraInfo

export type DebuggerEventExtraInfo = {
  target: object
  type: TrackOpTypes | TriggerOpTypes
  key: any
  newValue?: any
  oldValue?: any
  oldTarget?: Map<any, any> | Set<any>
}

export let activeEffect: ReactiveEffect | undefined

export const ITERATE_KEY = Symbol(__DEV__ ? 'iterate' : '')
export const MAP_KEY_ITERATE_KEY = Symbol(__DEV__ ? 'Map key iterate' : '')
/*
* 副作用对象
* */
export class ReactiveEffect<T = any> {
  //侦听是否可用，比如停止了？？
  active = true
  deps: Dep[] = []
  parent: ReactiveEffect | undefined = undefined

  /**
   * Can be attached after creation
   * @internal
   */
  computed?: ComputedRefImpl<T>
  /**
   * @internal
   */
  allowRecurse?: boolean

  onStop?: () => void
  // dev only
  onTrack?: (event: DebuggerEvent) => void
  // dev only
  onTrigger?: (event: DebuggerEvent) => void

  constructor(
    public fn: () => T,
    public scheduler: EffectScheduler | null = null,
    scope?: EffectScope
  ) {
    recordEffectScope(this, scope)
  }

  run() {
    // 允许在非 active 状态且非调度执行情况，则直接执行原始函数 fn 并返回
    if (!this.active) {
      return this.fn()
    }
    let parent: ReactiveEffect | undefined = activeEffect
    let lastShouldTrack = shouldTrack
    while (parent) {
      if (parent === this) {
        return
      }
      parent = parent.parent
    }
    try {
      //解决深嵌套场景的effect,保存上一个reactiveEffect
      //把当前effect的父级指向【目前正在执行中的】外层，然后将activeEffect指向【即将要执行的】内层
      this.parent = activeEffect
      activeEffect = this
      shouldTrack = true
      /*
      *      //  此处为什么要先放进去呢？因为你不知道下面 的fn执行过程中会不会继续有需要收集的响应式数据
        //  例如你有一个模板，包含一个计算属性；计算属性会先执行，但是因为计算属性是lazy=true,所以并不会取值；
        //   而当模板渲染的时候， 此处是componentEffect,而你在模板解析中还有计算属性，那就先把componentEffect存起来，
        //   然后呢，去执行当前的计算属性，把当前的计算属性effect设置为当前activeEffect，执行并设置值，然后从effectStack中清除
        // 这个计算属性的effect，把倒数第一个设置为当前的activeEffect,也就是刚才的那个componentEffect
        //   计算属性中或许你又依赖了其他的计算属性，无线套娃，所以呢存起来，一步一步来
      * */
      // 根据递归 || 嵌套 的深度记录位数，因为执行的是内层，所以在当前层次effectTrackDepth上在加一层，，即左移一位
      trackOpBit = 1 << ++effectTrackDepth
        //执行副作用函数前，给 ReactiveEffect 依赖的响应式变量，w标识位,wastracked
        // 超过 maxMarkerBits 则 trackOpBit 的计算会超过最大整形的位数，降级为 cleanupEffect
      if (effectTrackDepth <= maxMarkerBits) {
        //标记所有的的dep为was
        initDepMarkers(this)
      } else {
        //降级方案，删除所有依赖，重新收集依赖
        cleanupEffect(this)
      }
      return this.fn()//执行传入的副作用函数，会访问到响应式数据，就会触发他们的getter，进而执行track函数收集依赖，给新收集的依赖打上标记.n
    } finally {
      if (effectTrackDepth <= maxMarkerBits) {
          //执行完 副作用函数还会移除掉历史被收集但是新的一轮依赖收集中没有被收集的依赖，即.w 有值，.n无值的会被删除
        finalizeDepMarkers(this)
      }
        // 恢复到上一级
      trackOpBit = 1 << --effectTrackDepth

      activeEffect = this.parent
      shouldTrack = lastShouldTrack
      this.parent = undefined
    }
  }

  stop() {
    if (this.active) {
      cleanupEffect(this)
      if (this.onStop) {
        this.onStop()
      }
      this.active = false
    }
  }
}
//双向删除 ReactiveEffect 副作用对象的所有依赖
function cleanupEffect(effect: ReactiveEffect) {
  const { deps } = effect
  if (deps.length) {
    for (let i = 0; i < deps.length; i++) {
      deps[i].delete(effect)
    }
    deps.length = 0
  }
}

export interface DebuggerOptions {
  onTrack?: (event: DebuggerEvent) => void
  onTrigger?: (event: DebuggerEvent) => void
}

export interface ReactiveEffectOptions extends DebuggerOptions {
  lazy?: boolean
  scheduler?: EffectScheduler
  scope?: EffectScope
  allowRecurse?: boolean
  onStop?: () => void
}

export interface ReactiveEffectRunner<T = any> {
  (): T
  effect: ReactiveEffect
}
//传入effect的为副作用函数
export function effect<T = any>(
  fn: () => T,
  options?: ReactiveEffectOptions
): ReactiveEffectRunner {
  if ((fn as ReactiveEffectRunner).effect) {
    fn = (fn as ReactiveEffectRunner).effect.fn
  }

  const _effect = new ReactiveEffect(fn)
  if (options) {
    extend(_effect, options)
    if (options.scope) recordEffectScope(_effect, options.scope)
  }
  if (!options || !options.lazy) {
    _effect.run()
  }
  const runner = _effect.run.bind(_effect) as ReactiveEffectRunner
  runner.effect = _effect
  return runner
}

export function stop(runner: ReactiveEffectRunner) {
  runner.effect.stop()
}

export let shouldTrack = true
const trackStack: boolean[] = []

export function pauseTracking() {
  trackStack.push(shouldTrack)
  shouldTrack = false
}

export function enableTracking() {
  trackStack.push(shouldTrack)
  shouldTrack = true
}

export function resetTracking() {
  const last = trackStack.pop()
  shouldTrack = last === undefined ? true : last
}

export function track(target: object, type: TrackOpTypes, key: unknown) {
  if (shouldTrack && activeEffect) {
    let depsMap = targetMap.get(target)
    if (!depsMap) {
      targetMap.set(target, (depsMap = new Map()))
    }
    let dep = depsMap.get(key)
    if (!dep) {
      depsMap.set(key, (dep = createDep()))
    }

    const eventInfo = __DEV__
      ? { effect: activeEffect, target, type, key }
      : undefined

    trackEffects(dep, eventInfo)
  }
}

export function trackEffects(
  dep: Dep,
  debuggerEventExtraInfo?: DebuggerEventExtraInfo
) {
  let shouldTrack = false
  if (effectTrackDepth <= maxMarkerBits) {
    //此处写的好贱啊，方面名字贱的不行；看着像不是新的依赖，其实是新的、
    //如果不是重新收集的
    if (!newTracked(dep)) {
      // 标记为新依赖  更新依赖的深度
      dep.n |= trackOpBit // set newly tracked
      // 如果依赖已经被收集，则不需要再次收集
      shouldTrack = !wasTracked(dep)
    }
  } else {
    // Full cleanup mode.
    shouldTrack = !dep.has(activeEffect!)
  }

  if (shouldTrack) {
    // 收集当前激活的 effect 作为依赖
    dep.add(activeEffect!)
    // 当前激活的 effect 收集 dep 集合作为依赖
    activeEffect!.deps.push(dep)
    if (__DEV__ && activeEffect!.onTrack) {
      activeEffect!.onTrack(
        Object.assign(
          {
            effect: activeEffect!
          },
          debuggerEventExtraInfo
        )
      )
    }
  }
}

export function trigger(
  target: object,
  type: TriggerOpTypes,
  key?: unknown,
  newValue?: unknown,
  oldValue?: unknown,
  oldTarget?: Map<unknown, unknown> | Set<unknown>
) {
  const depsMap = targetMap.get(target)//查找该对象对应的KeyToDepMap<any,dep>
  if (!depsMap) {
    // never been tracked
    return
  }
  //声明一个最后需要处理的集合deps，依次收集    清除操作||数组修改长度||设置、新增、删除key值 ；然后根据类型，可能会对迭代器作为key值对应的dep监听也收集起来
  let deps: (Dep | undefined)[] = []
  //如果是清空操作，那么收集所有的依赖项的集合
  if (type === TriggerOpTypes.CLEAR) {
    // collection being cleared
    // trigger all effects for target
    deps = [...depsMap.values()]
  //  如果是key是length且原对象是数组， 就是直接修改数组的length   找到key是length 类型的或者下标在新的下标key位置及其后面的元素的dep  收集起来（注意，循环中key可以是length ，可以是indexof，也可以是数组的下标）
  } else if (key === 'length' && isArray(target)) {
    depsMap.forEach((dep, key) => {
      if (key === 'length' || key >= (newValue as number)) {
        deps.push(dep)
      }
    })
  } else {
    // schedule runs for SET | ADD | DELETE
    //如果key值存在，那么应该是设置，新增，或者删除操作，我们只需要收集这个key值对应的dep的
    if (key !== void 0) {
      deps.push(depsMap.get(key))
    }

    //因为新增，删减，或者设置新值，都会对遍历相关的监听产生影响，所以要把这些dep收集起来，e.g.  a=[1,2,3]  let b= Reflect.ownKeys(a)  c=new Set([1,2,3])  c.size()'
    // also run for iteration key on ADD | DELETE | Map.SET
    switch (type) {
      case TriggerOpTypes.ADD:
        //是set 或者map
        if (!isArray(target)) {
          //他俩都应该关心iterate_Key 对应着 forEach  size  keys[[set]]  values entries
          deps.push(depsMap.get(ITERATE_KEY))
          //如果是map 的话，还需要单独关心下 keys  上面 ITERATE_KEY 关心的是值，或者键值对，而针对map.keys得出来的是跟值本身完全没关系的。
          if (isMap(target)) {
            deps.push(depsMap.get(MAP_KEY_ITERATE_KEY))
          }
        } else if (isIntegerKey(key)) {
          // new index added to array -> length changes //此处跟前面的length会不会重复收集；哦数组不会，因为数组传递过来的的key是准备中的值，而不是length，上面 并不会收集
          deps.push(depsMap.get('length'))
        }
        break
      case TriggerOpTypes.DELETE:
        if (!isArray(target)) {
          deps.push(depsMap.get(ITERATE_KEY))
          if (isMap(target)) {
            deps.push(depsMap.get(MAP_KEY_ITERATE_KEY))
          }
        }
        break
      case TriggerOpTypes.SET:
        if (isMap(target)) {
          deps.push(depsMap.get(ITERATE_KEY))
        }
        break
    }
  }

  const eventInfo = __DEV__
    ? { target, type, key, newValue, oldValue, oldTarget }
    : undefined
  //一个人就必要麻烦别人了，就不封装了，直接执行函数即可。但是呢，明明可以放到多个里来处理，为啥不放呢？不理解
  if (deps.length === 1) {
    if (deps[0])
    {
      if (__DEV__) {
        triggerEffects(deps[0], eventInfo)
      } else {
        triggerEffects(deps[0])
      }
    }
  } else {
    const effects: ReactiveEffect[] = []
    for (const dep of deps) {
      if (dep) {
        effects.push(...dep)
      }
    }
    if (__DEV__) {
      triggerEffects(createDep(effects), eventInfo)
    } else {
      triggerEffects(createDep(effects))
    }
  }
}

export function triggerEffects(
  dep: Dep | ReactiveEffect[],
  debuggerEventExtraInfo?: DebuggerEventExtraInfo
) {
  // spread into array for stabilization
  // 循环遍历 dep，去取每个依赖的副作用对象 ReactiveEffect
  for (const effect of isArray(dep) ? dep : [...dep]) {
    // 默认不允许递归，即当前 effect 副作用函数，如果递归触发当前 effect，会被忽略
    if (effect !== activeEffect || effect.allowRecurse) {
      if (__DEV__ && effect.onTrigger) {
        effect.onTrigger(extend({ effect }, debuggerEventExtraInfo))
      }
      // effect.scheduler可以先不管，ref 和 reactive 都没有
      if (effect.scheduler) {
        effect.scheduler()
      } else {
        effect.run()  // 执行 effect 的副作用函数
      }
    }
  }
}
