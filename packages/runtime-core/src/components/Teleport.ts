import { ComponentInternalInstance } from '../component'
import { SuspenseBoundary } from './Suspense'
import {
  RendererInternals,
  MoveType,
  RendererElement,
  RendererNode,
  RendererOptions,
  traverseStaticChildren
} from '../renderer'
import { VNode, VNodeArrayChildren, VNodeProps } from '../vnode'
import { isString, ShapeFlags } from '@vue/shared'
import { warn } from '../warning'
import { isHmrUpdating } from '../hmr'

export type TeleportVNode = VNode<RendererNode, RendererElement, TeleportProps>

export interface TeleportProps {
  to: string | RendererElement | null | undefined
  disabled?: boolean
}

export const isTeleport = (type: any): boolean => type.__isTeleport

const isTeleportDisabled = (props: VNode['props']): boolean =>
  props && (props.disabled || props.disabled === '')

const isTargetSVG = (target: RendererElement): boolean =>
  typeof SVGElement !== 'undefined' && target instanceof SVGElement

const resolveTarget = <T = RendererElement>(
  props: TeleportProps | null,
  select: RendererOptions['querySelector']
): T | null => {
  const targetSelector = props && props.to
  if (isString(targetSelector)) {
    if (!select) {
      __DEV__ &&
        warn(
          `Current renderer does not support string target for Teleports. ` +
            `(missing querySelector renderer option)`
        )
      return null
    } else {
      const target = select(targetSelector)
      if (!target) {
        __DEV__ &&
          warn(
            `Failed to locate Teleport target with selector "${targetSelector}". ` +
              `Note the target element must exist before the component is mounted - ` +
              `i.e. the target cannot be rendered by the component itself, and ` +
              `ideally should be outside of the entire Vue component tree.`
          )
      }
      return target as T
    }
  } else {
    if (__DEV__ && !targetSelector && !isTeleportDisabled(props)) {
      warn(`Invalid Teleport target: ${targetSelector}`)
    }
    return targetSelector as T
  }
}

export const TeleportImpl = {
  __isTeleport: true,
  process(
    n1: TeleportVNode | null,
    n2: TeleportVNode,
    container: RendererElement,
    anchor: RendererNode | null,
    parentComponent: ComponentInternalInstance | null,
    parentSuspense: SuspenseBoundary | null,
    isSVG: boolean,
    slotScopeIds: string[] | null,
    optimized: boolean,
    internals: RendererInternals
  ) {
    const {
      mc: mountChildren,
      pc: patchChildren,
      pbc: patchBlockChildren,
      o: { insert, querySelector, createText, createComment }
    } = internals

    const disabled = isTeleportDisabled(n2.props)
    let { shapeFlag, children, dynamicChildren } = n2

    // #3302
    // HMR updated, force full diff
    if (__DEV__ && isHmrUpdating) {
      optimized = false
      dynamicChildren = null
    }

    if (n1 == null) {
      // insert anchors in the main view
      // 创建注释节点 标志着这个teleport原先在dom结构中哪个位置，我们称为原始锚点；具体见Demo/reactive/teleport.html
      const placeholder = (n2.el = __DEV__
        ? createComment('teleport start')
        : createText(''))
      const mainAnchor = (n2.anchor = __DEV__
        ? createComment('teleport end')
        : createText(''))
      // 插入注释节点 ,插入此时 teleport 组件在页面中的对应位置，即插入到 teleport 的父节点 container 中：
      insert(placeholder, container, anchor)
      insert(mainAnchor, container, anchor)
      //找到要挂载的dom节点，就是to属性指定的DOM选择器对应的元素
      const target = (n2.target = resolveTarget(n2.props, querySelector))
      const targetAnchor = (n2.targetAnchor = createText(''))
      //  teleport 对应的target的Dom存在，则插入一个空的文本节点，也可以称为占位节点
      if (target) {
        insert(targetAnchor, target)
        // #2652 we could be teleporting from a non-SVG tree into an SVG tree
        isSVG = isSVG || isTargetSVG(target)
      } else if (__DEV__ && !disabled) {
        warn('Invalid Teleport target on mount:', target, `(${typeof target})`)
      }

      const mount = (container: RendererElement, anchor: RendererNode) => {
        // Teleport *always* has Array children. This is enforced in both the
        // compiler and vnode children normalization.
        if (shapeFlag & ShapeFlags.ARRAY_CHILDREN) {
          mountChildren(
            children as VNodeArrayChildren,
            container,
            anchor,
            parentComponent,
            parentSuspense,
            isSVG,
            slotScopeIds,
            optimized
          )
        }
      }
      //如果新节点是teleport节点的禁用状态，那么就将新节点的子节点正常挂载到他在页面的原始位置，即上面声明的原始锚点
      if (disabled) {
        mount(container, mainAnchor)
      } else if (target) {
        //说明指定的目标节点是存在的，那么将子节点挂载到target上指定的锚点处
        mount(target, targetAnchor)
      }
    } else {
      // update content
      n2.el = n1.el
      const mainAnchor = (n2.anchor = n1.anchor)!
      const target = (n2.target = n1.target)!
      const targetAnchor = (n2.targetAnchor = n1.targetAnchor)!
      const wasDisabled = isTeleportDisabled(n1.props)
      const currentContainer = wasDisabled ? container : target
      const currentAnchor = wasDisabled ? mainAnchor : targetAnchor
      isSVG = isSVG || isTargetSVG(target)

      if (dynamicChildren) {
        // fast path when the teleport happens to be a block root
        patchBlockChildren(
          n1.dynamicChildren!,
          dynamicChildren,
          currentContainer,
          parentComponent,
          parentSuspense,
          isSVG,
          slotScopeIds
        )
        // even in block tree mode we need to make sure all root-level nodes
        // in the teleport inherit previous DOM references so that they can
        // be moved in future patches.
        traverseStaticChildren(n1, n2, true)
      } else if (!optimized) {
        patchChildren(
          n1,
          n2,
          currentContainer,
          currentAnchor,
          parentComponent,
          parentSuspense,
          isSVG,
          slotScopeIds,
          false
        )
      }

      //新的节点不需要移动
      if (disabled) {
        //  原先节点移动到target的情况
        if (!wasDisabled) {
          // enabled -> disabled
          // move into main container
          //  把原先的节点从target移动到main container
          moveTeleport(
            n2,
            container,
            mainAnchor,
            internals,
            TeleportMoveTypes.TOGGLE
          )
        }
      } else {
        // target changed   新的节点和旧的挂载节点不一致
        if ((n2.props && n2.props.to) !== (n1.props && n1.props.to)) {
          const nextTarget = (n2.target = resolveTarget(
            n2.props,
            querySelector
          ))
          if (nextTarget) {
            moveTeleport(
              n2,
              nextTarget,
              null,
              internals,
              TeleportMoveTypes.TARGET_CHANGE
            )
          } else if (__DEV__) {
            warn(
              'Invalid Teleport target on update:',
              target,
              `(${typeof target})`
            )
          }
        } else if (wasDisabled) { //  旧的挂载节点在main container的情况
          // disabled -> enabled
          // move into teleport target
          moveTeleport(
            n2,
            target,
            targetAnchor,
            internals,
            TeleportMoveTypes.TOGGLE
          )
        }
      }
    }

    updateCssVars(n2)
  },

  remove(
    vnode: VNode,
    parentComponent: ComponentInternalInstance | null,
    parentSuspense: SuspenseBoundary | null,
    optimized: boolean,
    { um: unmount, o: { remove: hostRemove } }: RendererInternals,
    doRemove: Boolean
  ) {
    const { shapeFlag, children, anchor, targetAnchor, target, props } = vnode

    if (target) {
      hostRemove(targetAnchor!)
    }

    // an unmounted teleport should always remove its children if not disabled
    if (doRemove || !isTeleportDisabled(props)) {
      hostRemove(anchor!)
      if (shapeFlag & ShapeFlags.ARRAY_CHILDREN) {
        for (let i = 0; i < (children as VNode[]).length; i++) {
          const child = (children as VNode[])[i]
          unmount(
            child,
            parentComponent,
            parentSuspense,
            true,
            !!child.dynamicChildren
          )
        }
      }
    }
  },

  move: moveTeleport,
  hydrate: hydrateTeleport
}

export const enum TeleportMoveTypes {
  TARGET_CHANGE,
  TOGGLE, // enable / disable
  REORDER // moved in the main view
}

function moveTeleport(
  vnode: VNode,
  container: RendererElement,
  parentAnchor: RendererNode | null,
  { o: { insert }, m: move }: RendererInternals,
  moveType: TeleportMoveTypes = TeleportMoveTypes.REORDER
) {
  // move target anchor if this is a target change.
  if (moveType === TeleportMoveTypes.TARGET_CHANGE) {
    insert(vnode.targetAnchor!, container, parentAnchor)
  }
  const { el, anchor, shapeFlag, children, props } = vnode
  const isReorder = moveType === TeleportMoveTypes.REORDER
  // move main view anchor if this is a re-order.
  if (isReorder) {
    insert(el!, container, parentAnchor)
  }
  // if this is a re-order and teleport is enabled (content is in target)
  // do not move children. So the opposite is: only move children if this
  // is not a reorder, or the teleport is disabled
  if (!isReorder || isTeleportDisabled(props)) {
    // Teleport has either Array children or no children.
    if (shapeFlag & ShapeFlags.ARRAY_CHILDREN) {
      for (let i = 0; i < (children as VNode[]).length; i++) {
        move(
          (children as VNode[])[i],
          container,
          parentAnchor,
          MoveType.REORDER
        )
      }
    }
  }
  // move main view anchor if this is a re-order.
  if (isReorder) {
    insert(anchor!, container, parentAnchor)
  }
}

interface TeleportTargetElement extends Element {
  // last teleport target
  _lpa?: Node | null
}

function hydrateTeleport(
  node: Node,
  vnode: TeleportVNode,
  parentComponent: ComponentInternalInstance | null,
  parentSuspense: SuspenseBoundary | null,
  slotScopeIds: string[] | null,
  optimized: boolean,
  {
    o: { nextSibling, parentNode, querySelector }
  }: RendererInternals<Node, Element>,
  hydrateChildren: (
    node: Node | null,
    vnode: VNode,
    container: Element,
    parentComponent: ComponentInternalInstance | null,
    parentSuspense: SuspenseBoundary | null,
    slotScopeIds: string[] | null,
    optimized: boolean
  ) => Node | null
): Node | null {
  const target = (vnode.target = resolveTarget<Element>(
    vnode.props,
    querySelector
  ))
  if (target) {
    // if multiple teleports rendered to the same target element, we need to
    // pick up from where the last teleport finished instead of the first node
    const targetNode =
      (target as TeleportTargetElement)._lpa || target.firstChild
    if (vnode.shapeFlag & ShapeFlags.ARRAY_CHILDREN) {
      if (isTeleportDisabled(vnode.props)) {
        vnode.anchor = hydrateChildren(
          nextSibling(node),
          vnode,
          parentNode(node)!,
          parentComponent,
          parentSuspense,
          slotScopeIds,
          optimized
        )
        vnode.targetAnchor = targetNode
      } else {
        vnode.anchor = nextSibling(node)

        // lookahead until we find the target anchor
        // we cannot rely on return value of hydrateChildren() because there
        // could be nested teleports
        let targetAnchor = targetNode
        while (targetAnchor) {
          targetAnchor = nextSibling(targetAnchor)
          if (
            targetAnchor &&
            targetAnchor.nodeType === 8 &&
            (targetAnchor as Comment).data === 'teleport anchor'
          ) {
            vnode.targetAnchor = targetAnchor
            ;(target as TeleportTargetElement)._lpa =
              vnode.targetAnchor && nextSibling(vnode.targetAnchor as Node)
            break
          }
        }

        hydrateChildren(
          targetNode,
          vnode,
          target,
          parentComponent,
          parentSuspense,
          slotScopeIds,
          optimized
        )
      }
    }
    updateCssVars(vnode)
  }
  return vnode.anchor && nextSibling(vnode.anchor as Node)
}

// Force-casted public typing for h and TSX props inference
export const Teleport = TeleportImpl as unknown as {
  __isTeleport: true
  new(): {
    $props: VNodeProps & TeleportProps
    $slots: {
      default(): VNode[]
    }
  }
}

function updateCssVars(vnode: VNode) {
  // presence of .ut method indicates owner component uses css vars.
  // code path here can assume browser environment.
  const ctx = vnode.ctx
  if (ctx && ctx.ut) {
    let node = (vnode.children as VNode[])[0].el!
    while (node !== vnode.targetAnchor) {
      if (node.nodeType === 1) node.setAttribute('data-v-owner', ctx.uid)
      node = node.nextSibling
    }
    ctx.ut()
  }
}
