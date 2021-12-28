import * as React from 'react'
import create from 'zustand'
import produce from 'immer'
import {
    deepClone,
    keySet,
    keyGet,
    keyDelete,
    keyApply,
    keySwap,
    INDEX_IS,
    isDefined,
    isNotDefined,
    getParentOrSelfKeys,
    proxyTraverse,
    uuidv4
} from "./utilities"

export const PROXY_KEY = "fields"

function setField(set, get, key, value) {
    set(draft => {
        keySet(key, value, draft.values)
	// Only set metadata if the field has been registered.
        if (isDefined(keyGet(key, draft.meta, PROXY_KEY))) {
	    keySet(key, true, draft.meta, PROXY_KEY, getDefaultMeta(), "touched")
        }
    })
}

function deleteField(set, get, key) {
    set(draft => {
        keyDelete(key, draft.values)
	keyDelete(key, draft.meta, PROXY_KEY)
    })
}


function validateForm(set, get) {
    let validation = []
    set(draft => {
	proxyTraverse(
	    draft.meta,
	    (obj) => { obj.formValidation = [] },
	    PROXY_KEY
	)

	validation = draft.meta.validators.reduce((agg, validator) => {
	    return [...agg, ...validator.validate(draft.values)]
	}, [])

	validation.forEach(v => {
	    if (isDefined(v.key)) {
		const current = keyGet(v.key, draft.meta, PROXY_KEY)
		keySet(
		    v.key,
		    [
			...(isDefined(current) && isDefined(current.formValidation)
			    ? current.formValidation : []),
			v
		    ],
		    draft.meta,
		    PROXY_KEY,
		    getDefaultMeta(),
		    "formValidation"
		)
	    } else {
		draft.meta.formValidation.push(v)
	    }
	})
    })
    return validation
}

function validateField(set, get, key) {
    set(draft => {
        let validation =  draft.meta.validators.reduce((agg, formValidator) => {
	    if (isDefined(formValidator.validateField)) {
                return [...agg, ...formValidator.validateField({
		    name: key,
		    value: keyGet(key, draft.values),
		    values: draft.values
		})]
	    } else {
                return agg
	    }
        }, [])

	const _validators = keyGet(key, draft.meta, PROXY_KEY).validators
	if (isDefined(_validators)) {
	    validation = [
		...validation,
		..._validators.reduce((agg, validator) => {
		    return [
			...agg,
			...validator({
			    name: key,
			    value: keyGet(key, draft.values),
			    form: draft
			})
		    ]
		}, [])
	    ]
	}
	keySet(key, validation, draft.meta, PROXY_KEY, getDefaultMeta(), "fieldValidation")
    })
}


function swapField(set, get, keyA, keyB) {
    set(draft => {
	keySwap(keyA, keyB, draft.values)
	keySwap(keyA, keyB, draft.meta, PROXY_KEY)
    })
}

function registerField({set, get, name, defaultValue, defaultMeta, key}) {
    const _meta = {
	...getDefaultMeta(key),
	...(isDefined(defaultMeta) ? deepClone(defaultMeta) :  {}),
	isRegistered: true
    }
    _meta.defaultValue = deepClone(defaultValue)

    set(draft => {

	const value = keyGet(name, draft.values)
        if (isNotDefined(value)) {
            if (isDefined(defaultValue)) {
                keySet(name, defaultValue, draft.values)
            }
	}

	if (isNotDefined(keyGet(name, draft.meta, PROXY_KEY))) {
	    keySet(name, _meta, draft.meta, PROXY_KEY, getDefaultMeta())
        }

    })

}

// Use immer for all calls to zustand set
function formSetMiddleware(config) {
    return function(set, get, api) {
        return config((partial, replace) => {
            const nextState = produce(partial)
            return set(nextState, replace)
        }, get, api)
    }
}

export function getDefaultMeta(key) {
    const defaultMeta = {
	isRegistered: false,
	validators: [],
	fieldValidation: [],
	formValidation: [],
        touched: false,
	key: isDefined(key) ? key : uuidv4(),
	user: {}
    }
    return deepClone(defaultMeta)
}


export function useFormicious(params) {
    const {form, values, meta, validators, handleSubmit} = params || {}
    const [_form] = React.useState(React.useCallback(
	() => isDefined(form) ? form : createForm({values, meta, handleSubmit})
    ), [form, values, meta])

    const formProps = _form(React.useCallback(form => form.formProps, []))
    return [formProps, _form]
}


export function useAction(form, action) {
    const _selector = React.useCallback(form => form.actions[action], [])
    return form(_selector)
}


export function useField(
    {form, name, defaultValue, defaultMeta, transformValueIn, transformValueOut, selector}
) {


    // NOTE These are why it's re-rendering. We need to apply
    // any transforms here and get value/meta in the same call and
    // we can define a comparison that prevents render.
    // According to React this is all happening in the component where the
    // custom hook is called, that's why it's always rendering.
    // make getFieldProps an action so it's out of here...?
    const ret = form(
	React.useCallback(
	    state => {
		let value = keyGet(name, state.values)
		value = isDefined(value) ? value : deepClone(defaultValue)

		let meta = keyGet(name, state.meta, PROXY_KEY)
		meta = isDefined(meta) ? meta : getDefaultMeta()
		if (isNotDefined(meta.key)) {
		    meta.key = uuidv4()
		}

		if (isDefined(transformValueOut)) {
		    value = transformValueOut(value)
		}

		const ret = {
		    value,
		    meta,
		    actions: {
			registerField: function() {
			    state.actions.registerField({name, defaultValue, defaultMeta, key: meta.key})
			},
			validateField: function() { state.actions.validateField(name) },
			setField: function(value) { state.actions.setField(name, value) },
			deleteField: function() { state.actions.deleteField(name) },
			swapWith: function(key) { state.actions.swapField(name, key) }
		    },
		    props: {
			id: name,
			name,
			onChange: function(e) {
			    let inValue;
			    if ('target' in e && 'value' in e.target) {
				inValue = e.target.value
			    } else {
				inValue = e
			    }
			    inValue = isDefined(transformValueIn) ? transformValueIn(inValue) : inValue
			    state.actions.setField(name, inValue)
			},
			onBlur: function() {
			    state.actions.validateField(name)
			},
			value
		    }
		}

		if (isDefined(selector)) {
		    ret.selector = selector(ret)
		}
		return ret
	    },
	    [name, defaultValue, defaultMeta, transformValueIn, transformValueOut, selector]
	),

	// NOTE This seems a bit silly, but it works...
	(a,b) => {
	    if (isDefined(a.selector) || isDefined(b.selector)) {
		return JSON.stringify(a.selector) === JSON.stringify(b.selector)
	    } else {
		return JSON.stringify(a) === JSON.stringify(b)
	    }
	}
    )

    React.useEffect(ret.actions.registerField, [])

    if (isDefined(ret.selector)) {
	return ret.selector
    } else {
	return ret
    }
}


function initializeForm({set, get, values, meta}) {
    set(draft => {
        draft.values = isDefined(values) ? deepClone(values) : {}
        draft.meta = {
	    validators: [],
	    ...(isDefined(meta) ? deepClone(meta) : {})
	}
        draft.initialized = true
    })
}

export function createForm({
	values,
	meta,
	validators,
	handleSubmit
}) {
    /** Create a formicious form.
    */
    const ret = create(
        formSetMiddleware(
            (set, get, api) => ({
		initialized: false,
		values: isDefined(values) ? deepClone(values) : {},
                meta: {validators: [], ...(isDefined(meta) ? deepClone(meta) : {})},
                formProps: {
		    onSubmit: function(e) {
                        e.preventDefault();
                        if (isDefined(handleSubmit)) {
			    handleSubmit(get().values)
                        } else {
			    console.log(get().values)
                        }
		    }
                },
                actions: {
                    registerField: function({
			name,
			defaultValue,
			defaultMeta
		    }) {
                        return registerField({
			    set,
			    get,
			    name,
			    defaultValue,
			    defaultMeta
			})
                    },
                    deleteField: function(name) { deleteField(set, get, name) },
                    swapField: function(nameA, nameB) { swapField(set, get, nameA, nameB) },
		    blurField: function(name) { blurField(set, get, name) },
                    setField: function(name, value) { setField(set, get, name, value) },
		    validateField: function(name) { validateField(set, get, name) },
		    validateForm: function() { validateForm(set, get) },
                    initialize: function({values, meta}) {
			initializeForm({set, get, values, meta})
		    }
                },
            })
        )
    )
    return ret
}