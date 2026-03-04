# PaginationMeta

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**Page** | Pointer to **int32** |  | [optional] 
**Limit** | Pointer to **int32** |  | [optional] 
**Total** | Pointer to **int32** |  | [optional] 
**HasMore** | Pointer to **bool** |  | [optional] 

## Methods

### NewPaginationMeta

`func NewPaginationMeta() *PaginationMeta`

NewPaginationMeta instantiates a new PaginationMeta object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewPaginationMetaWithDefaults

`func NewPaginationMetaWithDefaults() *PaginationMeta`

NewPaginationMetaWithDefaults instantiates a new PaginationMeta object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetPage

`func (o *PaginationMeta) GetPage() int32`

GetPage returns the Page field if non-nil, zero value otherwise.

### GetPageOk

`func (o *PaginationMeta) GetPageOk() (*int32, bool)`

GetPageOk returns a tuple with the Page field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetPage

`func (o *PaginationMeta) SetPage(v int32)`

SetPage sets Page field to given value.

### HasPage

`func (o *PaginationMeta) HasPage() bool`

HasPage returns a boolean if a field has been set.

### GetLimit

`func (o *PaginationMeta) GetLimit() int32`

GetLimit returns the Limit field if non-nil, zero value otherwise.

### GetLimitOk

`func (o *PaginationMeta) GetLimitOk() (*int32, bool)`

GetLimitOk returns a tuple with the Limit field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetLimit

`func (o *PaginationMeta) SetLimit(v int32)`

SetLimit sets Limit field to given value.

### HasLimit

`func (o *PaginationMeta) HasLimit() bool`

HasLimit returns a boolean if a field has been set.

### GetTotal

`func (o *PaginationMeta) GetTotal() int32`

GetTotal returns the Total field if non-nil, zero value otherwise.

### GetTotalOk

`func (o *PaginationMeta) GetTotalOk() (*int32, bool)`

GetTotalOk returns a tuple with the Total field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetTotal

`func (o *PaginationMeta) SetTotal(v int32)`

SetTotal sets Total field to given value.

### HasTotal

`func (o *PaginationMeta) HasTotal() bool`

HasTotal returns a boolean if a field has been set.

### GetHasMore

`func (o *PaginationMeta) GetHasMore() bool`

GetHasMore returns the HasMore field if non-nil, zero value otherwise.

### GetHasMoreOk

`func (o *PaginationMeta) GetHasMoreOk() (*bool, bool)`

GetHasMoreOk returns a tuple with the HasMore field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetHasMore

`func (o *PaginationMeta) SetHasMore(v bool)`

SetHasMore sets HasMore field to given value.

### HasHasMore

`func (o *PaginationMeta) HasHasMore() bool`

HasHasMore returns a boolean if a field has been set.


[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


