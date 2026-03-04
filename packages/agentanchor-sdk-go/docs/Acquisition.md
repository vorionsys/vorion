# Acquisition

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**Id** | Pointer to **string** |  | [optional] 
**ListingId** | Pointer to **string** |  | [optional] 
**ConsumerId** | Pointer to **string** |  | [optional] 
**Status** | Pointer to **string** |  | [optional] 
**AcquiredAt** | Pointer to **time.Time** |  | [optional] 

## Methods

### NewAcquisition

`func NewAcquisition() *Acquisition`

NewAcquisition instantiates a new Acquisition object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewAcquisitionWithDefaults

`func NewAcquisitionWithDefaults() *Acquisition`

NewAcquisitionWithDefaults instantiates a new Acquisition object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetId

`func (o *Acquisition) GetId() string`

GetId returns the Id field if non-nil, zero value otherwise.

### GetIdOk

`func (o *Acquisition) GetIdOk() (*string, bool)`

GetIdOk returns a tuple with the Id field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetId

`func (o *Acquisition) SetId(v string)`

SetId sets Id field to given value.

### HasId

`func (o *Acquisition) HasId() bool`

HasId returns a boolean if a field has been set.

### GetListingId

`func (o *Acquisition) GetListingId() string`

GetListingId returns the ListingId field if non-nil, zero value otherwise.

### GetListingIdOk

`func (o *Acquisition) GetListingIdOk() (*string, bool)`

GetListingIdOk returns a tuple with the ListingId field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetListingId

`func (o *Acquisition) SetListingId(v string)`

SetListingId sets ListingId field to given value.

### HasListingId

`func (o *Acquisition) HasListingId() bool`

HasListingId returns a boolean if a field has been set.

### GetConsumerId

`func (o *Acquisition) GetConsumerId() string`

GetConsumerId returns the ConsumerId field if non-nil, zero value otherwise.

### GetConsumerIdOk

`func (o *Acquisition) GetConsumerIdOk() (*string, bool)`

GetConsumerIdOk returns a tuple with the ConsumerId field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetConsumerId

`func (o *Acquisition) SetConsumerId(v string)`

SetConsumerId sets ConsumerId field to given value.

### HasConsumerId

`func (o *Acquisition) HasConsumerId() bool`

HasConsumerId returns a boolean if a field has been set.

### GetStatus

`func (o *Acquisition) GetStatus() string`

GetStatus returns the Status field if non-nil, zero value otherwise.

### GetStatusOk

`func (o *Acquisition) GetStatusOk() (*string, bool)`

GetStatusOk returns a tuple with the Status field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetStatus

`func (o *Acquisition) SetStatus(v string)`

SetStatus sets Status field to given value.

### HasStatus

`func (o *Acquisition) HasStatus() bool`

HasStatus returns a boolean if a field has been set.

### GetAcquiredAt

`func (o *Acquisition) GetAcquiredAt() time.Time`

GetAcquiredAt returns the AcquiredAt field if non-nil, zero value otherwise.

### GetAcquiredAtOk

`func (o *Acquisition) GetAcquiredAtOk() (*time.Time, bool)`

GetAcquiredAtOk returns a tuple with the AcquiredAt field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetAcquiredAt

`func (o *Acquisition) SetAcquiredAt(v time.Time)`

SetAcquiredAt sets AcquiredAt field to given value.

### HasAcquiredAt

`func (o *Acquisition) HasAcquiredAt() bool`

HasAcquiredAt returns a boolean if a field has been set.


[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


